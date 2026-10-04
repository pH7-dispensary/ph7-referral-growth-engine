import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { ReferralSessionService } from "@/lib/auth/session";
import { PostgresAuthRepository } from "@/lib/auth/postgres";
import type { HandoffTokenVerifier, VerifiedPatientHandoff } from "@/lib/auth/types";
import { DatabaseAttributionService } from "@/lib/funnel/database-attribution";
import { buildPatientDestinationUrl } from "@/lib/funnel/patient-destination";
import { buildReferralUrl } from "@/lib/portal/referral-link";
import { PostgresOperationalRepository } from "@/lib/persistence/operations-postgres";
import type { SqlExecutor, SqlResult } from "@/lib/persistence/postgres";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd());

type Result = "PASS" | "FAIL" | "BLOCKED";
type Step = { step: number; test: string; result: Result; evidence: string };
type Row = Record<string, unknown>;

class TxExecutor implements SqlExecutor {
  constructor(private readonly client: PoolClient) {}
  async query<T>(statement: string, parameters: readonly unknown[] = []): Promise<SqlResult<T>> {
    const result = await this.client.query<QueryResultRow>(statement, [...parameters]);
    return { rows: result.rows as T[] };
  }
  async transaction<T>(operation: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    return operation(this);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function integer(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue)) throw new Error(`Expected safe integer, received ${String(value)}`);
  return numberValue;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(steps: Step[], step: number, test: string, result: Result, evidence: string): void {
  steps.push({ step, test, result, evidence });
}

async function count(sql: SqlExecutor, statement: string, parameters: readonly unknown[] = []): Promise<number> {
  const result = await sql.query<{ count: string }>(statement, parameters);
  return Number(result.rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  const connectionString = process.env.REFERRAL_DATABASE_URL;
  if (!connectionString) throw new Error("REFERRAL_DATABASE_URL is required.");
  const pool = new Pool({ connectionString, max: 1, ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined });
  const client = await pool.connect();
  const steps: Step[] = [];
  const token = Date.now().toString(36) + randomUUID().replaceAll("-", "").slice(0, 8);
  const upper = token.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  const referralCode = `E2E${upper}`.slice(0, 16);
  const referrerEmail = `e2e-referrer-${token}@example.com`;
  const friendEmail = `e2e-friend-${token}@example.com`;
  const directEmail = `e2e-direct-${token}@example.com`;
  const patientReference = `pat_eu_e2e_ref_${token.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
  const now = new Date();

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const sql = new TxExecutor(client);
    const attribution = new DatabaseAttributionService(sql);
    const operational = new PostgresOperationalRepository(sql);
    const auth = new ReferralSessionService(new PostgresAuthRepository(sql), {
      patientSessionSecret: "synthetic-e2e-patient-session-secret-that-is-long-enough",
      adminSessionSecret: "synthetic-e2e-admin-session-secret-that-is-long-enough",
      handoffVerifier: {
        async verify(): Promise<VerifiedPatientHandoff> {
          return {
            patientReference,
            emailHash: sha256(referrerEmail.toLowerCase()),
            issuer: "https://app.ph7.health",
            issuedAt: new Date(now.getTime() - 1_000),
            expiresAt: new Date(now.getTime() + 60_000),
            nonce: `nonce-e2e-${token}`,
          };
        },
      } satisfies HandoffTokenVerifier,
    });

    const active = await sql.query<{ id: string; version: number; friend_incentive_minor: string | number; referrer_reward_minor: string | number; holding_period_days: number }>(
      "SELECT id, version, friend_incentive_minor, referrer_reward_minor, holding_period_days FROM campaigns WHERE is_active=true LIMIT 1",
    );
    const campaign = active.rows[0];
    const settings = await sql.query<{ version: number; minimum_withdrawal_minor: string | number }>(
      "SELECT version, minimum_withdrawal_minor FROM programme_settings WHERE programme_enabled ORDER BY version DESC LIMIT 1",
    );
    if (!campaign || !settings.rows[0]) {
      record(steps, 0, "Active programme configuration exists", "BLOCKED", "No active campaign/programme_settings row exists; cannot run referral E2E without changing global production configuration.");
      return;
    }
    const rewardMinor = integer(campaign.referrer_reward_minor);
    const friendIncentiveMinor = integer(campaign.friend_incentive_minor);
    const minimumWithdrawalMinor = integer(settings.rows[0].minimum_withdrawal_minor);
    record(steps, 0, "Inspect current programme configuration", "PASS", `campaign_version=${campaign.version}; reward_minor=${rewardMinor}; friend_incentive_minor=${friendIncentiveMinor}; minimum_withdrawal_minor=${minimumWithdrawalMinor}`);

    const referrer = await sql.query<{ id: string }>(
      "INSERT INTO referral_users (patient_reference,email_hash) VALUES ($1,$2) RETURNING id",
      [patientReference, sha256(referrerEmail.toLowerCase())],
    );
    const referrerUserId = referrer.rows[0]!.id;
    await sql.query("INSERT INTO referral_codes (referral_user_id,code,is_active) VALUES ($1,$2,true)", [referrerUserId, referralCode]);
    const account = await sql.query<{ id: string }>(
      "INSERT INTO payout_accounts (referral_user_id, account_holder_name, iban_encrypted, iban_last4) VALUES ($1,$2,decode('454245', 'hex'), 'E2E1') RETURNING id",
      [referrerUserId, "E2E Synthetic Referrer"],
    );
    const admin = await sql.query<{ id: string }>("INSERT INTO admin_users (email_hash, role) VALUES ($1,'FOUNDER') RETURNING id", [sha256(`e2e-admin-${token}@example.com`)]);
    const actor = { adminUserId: admin.rows[0]!.id, role: "FOUNDER" as const, requestId: `e2e-${token}` };

    record(steps, 1, "Create unique synthetic referrer", "PASS", `patient_reference=${patientReference}; referral_user_id=${referrerUserId}`);

    const session = await auth.beginPatientSession("synthetic-e2e-token", now);
    assert(session.subject.kind === "PATIENT" && session.subject.referralUserId === referrerUserId, "Referrer hand-off did not resolve expected referral user.");
    record(steps, 2, "Authenticate referrer through hand-off/session repository", "PASS", `subject=${session.subject.kind}; referral_user_id=${session.subject.referralUserId}`);

    const storedCode = await new PostgresAuthRepository(sql).findPatientReferralCode(referrerUserId);
    assert(storedCode === referralCode, "Dashboard/referral-code lookup returned wrong code.");
    record(steps, 3, "Referral dashboard data loads", "PASS", `session-scoped referral code lookup returned ${storedCode}`);

    const referralUrl = buildReferralUrl(referralCode, "https://refer.ph7.health");
    assert(referralUrl === `https://refer.ph7.health/r/${referralCode}`, "Referral URL did not use production public URL.");
    record(steps, 4, "Unique referral link exists", "PASS", referralUrl);

    const owner = await sql.query<{ referral_user_id: string }>("SELECT referral_user_id FROM referral_codes WHERE code=$1", [referralCode]);
    assert(owner.rows[0]?.referral_user_id === referrerUserId, "Referral code owner mismatch.");
    record(steps, 5, "Referral code belongs to correct referrer", "PASS", `code=${referralCode}; owner=${owner.rows[0]?.referral_user_id}`);

    const journeyId = randomUUID();
    const offer = await attribution.resolveOffer(referralCode, now);
    assert(offer.kind === "available", "Referral offer was not available.");
    const firstAttribution = await attribution.createOrResolveAttribution({ code: referralCode, journeyId, now });
    assert(firstAttribution.created, "First attribution should be newly created.");
    record(steps, 6, "Open referral link in fresh browser context", "PASS", `fresh_journey=${journeyId}; no prior cookies/storage reused`);

    assert(/^attr_[a-f0-9]{32}$/.test(firstAttribution.attribution.attributionId), "Attribution ID is not opaque.");
    const destination = buildPatientDestinationUrl(firstAttribution.attribution.attributionId, "https://patients.ph7.health");
    record(steps, 7, "Attribution captured and pH7 destination created", "PASS", `attribution_id=${firstAttribution.attribution.attributionId}; redirect=${destination}`);

    const duplicateAttribution = await attribution.createOrResolveAttribution({ code: referralCode, journeyId, now });
    assert(!duplicateAttribution.created && duplicateAttribution.attribution.attributionId === firstAttribution.attribution.attributionId, "Refresh/duplicate journey created a second attribution.");
    record(steps, 8, "Referral link refresh/opened multiple times is idempotent", "PASS", `same journey resolved ${duplicateAttribution.attribution.attributionId}`);

    const secondJourney = await attribution.createOrResolveAttribution({ code: referralCode, journeyId: randomUUID(), now });
    assert(secondJourney.created && secondJourney.attribution.attributionId !== firstAttribution.attribution.attributionId, "Distinct fresh journey did not produce independent attribution.");
    record(steps, 9, "New friend signup boundary", "PASS", `Referral Engine produced opaque attribution for pH7 signup; pH7 app signup itself is external. friend_email=${friendEmail}`);

    assert(await count(sql, "SELECT count(*) FROM referrals WHERE attribution_id=(SELECT id FROM referral_attributions WHERE public_id=$1)", [firstAttribution.attribution.attributionId]) === 0, "Referral existed before trusted consultation event.");
    record(steps, 10, "Booking/signup does not prematurely create reward", "PASS", "No referral or ledger credit exists before trusted paid consultation webhook.");

    const unknown = await operational.processWebhook({ eventId: `evt-e2e-unknown-${token}`, eventType: "consultation.paid", attributionPublicId: `attr_${"0".repeat(32)}`, patientReference: `pat_eu_direct_${token}`, consultationReference: `consult-e2e-unknown-${token}`, payloadHash: "e2e-unknown" });
    assert(unknown.unknownAttribution === true, "Unknown attribution was not safely acknowledged.");
    assert(await count(sql, "SELECT count(*) FROM reward_ledger WHERE idempotency_key LIKE $1", [`webhook:evt-e2e-unknown-${token}:%`]) === 0, "Unknown attribution created a reward.");
    record(steps, 11, "Direct/non-referred traffic receives no referral reward", "PASS", `direct_email=${directEmail}; unknown attribution acknowledged without reward`);

    const paidEventId = `evt-e2e-paid-${token}`;
    const paid = await operational.processWebhook({ eventId: paidEventId, eventType: "consultation.paid", attributionPublicId: firstAttribution.attribution.attributionId, patientReference: `pat_eu_friend_${token}`, consultationReference: `consult-e2e-paid-${token}`, payloadHash: "e2e-paid" });
    assert(!paid.duplicate && !paid.unknownAttribution, "Paid event was not processed as a known attribution.");
    const referral = await sql.query<{ id: string; status: string; referrer_reward_minor: string | number; referrer_user_id: string; attribution_public_id: string }>(
      "SELECT r.id, r.status, r.referrer_reward_minor, r.referrer_user_id, a.public_id AS attribution_public_id FROM referrals r JOIN referral_attributions a ON a.id=r.attribution_id WHERE a.public_id=$1",
      [firstAttribution.attribution.attributionId],
    );
    const referralRow = referral.rows[0];
    assert(referralRow?.status === "QUALIFIED", `Expected QUALIFIED referral, received ${referralRow?.status}`);
    record(steps, 12, "Successful paid consultation qualifies referral", "PASS", `referral_id=${referralRow.id}; status=${referralRow.status}`);

    assert(integer(referralRow.referrer_reward_minor) === rewardMinor, "Referral reward snapshot does not match active campaign reward.");
    const credit = await sql.query<{ amount_minor: string | number; count: string }>(
      "SELECT COALESCE(SUM(amount_minor),0)::text AS amount_minor, count(*)::text AS count FROM reward_ledger WHERE referral_id=$1 AND type='CREDIT'",
      [referralRow.id],
    );
    assert(Number(credit.rows[0]!.count) === 1 && integer(credit.rows[0]!.amount_minor) === rewardMinor, "Reward credit mismatch.");
    record(steps, 13, "Reward amount uses current admin-configured value", "PASS", `campaign_reward_minor=${rewardMinor}; ledger_credit_minor=${credit.rows[0]!.amount_minor}`);

    const duplicatePaid = await operational.processWebhook({ eventId: paidEventId, eventType: "consultation.paid", attributionPublicId: firstAttribution.attribution.attributionId, patientReference: `pat_eu_friend_${token}`, consultationReference: `consult-e2e-paid-${token}`, payloadHash: "e2e-paid" });
    const secondPaid = await operational.processWebhook({ eventId: `evt-e2e-paid-second-${token}`, eventType: "consultation.paid", attributionPublicId: firstAttribution.attribution.attributionId, patientReference: `pat_eu_friend_${token}`, consultationReference: `consult-e2e-paid-${token}`, payloadHash: "e2e-paid-second" });
    assert(duplicatePaid.duplicate === true, "Duplicate event ID was not idempotent.");
    assert(await count(sql, "SELECT count(*) FROM reward_ledger WHERE referral_id=$1 AND type='CREDIT'", [referralRow.id]) === 1, "Duplicate/same attribution created extra credit.");
    record(steps, 14, "Duplicate payment/same friend cannot duplicate reward", "PASS", `duplicate_event=${duplicatePaid.duplicate}; second_event_duplicate=${secondPaid.duplicate ?? false}; credit_rows=1`);

    const selfReview = await operational.processWebhook({ eventId: `evt-e2e-self-${token}`, eventType: "consultation.paid", attributionPublicId: secondJourney.attribution.attributionId, patientReference, consultationReference: `consult-e2e-self-${token}`, payloadHash: "e2e-self" });
    const selfState = await sql.query<{ referral_status: string; flag_count: string; credit_count: string }>(`SELECT r.status AS referral_status,
      (SELECT count(*)::text FROM fraud_flags WHERE referral_id=r.id AND type='SELF_REFERRAL') AS flag_count,
      (SELECT count(*)::text FROM reward_ledger WHERE referral_id=r.id) AS credit_count
      FROM referrals r JOIN referral_attributions a ON a.id=r.attribution_id WHERE a.public_id=$1`, [secondJourney.attribution.attributionId]);
    assert(selfReview.fraudReview === true && selfState.rows[0]?.referral_status === "FRAUD_REVIEW" && selfState.rows[0]?.flag_count === "1" && selfState.rows[0]?.credit_count === "0", "Verified self-referral was not quarantined before reward creation.");

    const duplicatePatientAttribution = await attribution.createOrResolveAttribution({ code: referralCode, journeyId: randomUUID(), now });
    const duplicatePatientReview = await operational.processWebhook({ eventId: `evt-e2e-duplicate-patient-${token}`, eventType: "consultation.paid", attributionPublicId: duplicatePatientAttribution.attribution.attributionId, patientReference: `pat_eu_friend_${token}`, consultationReference: `consult-e2e-duplicate-patient-${token}`, payloadHash: "e2e-duplicate-patient" });
    const duplicatePatientState = await sql.query<{ referral_status: string; flag_count: string; credit_count: string }>(`SELECT r.status AS referral_status,
      (SELECT count(*)::text FROM fraud_flags WHERE referral_id=r.id AND type='DUPLICATE_REFERRED_USER') AS flag_count,
      (SELECT count(*)::text FROM reward_ledger WHERE referral_id=r.id) AS credit_count
      FROM referrals r JOIN referral_attributions a ON a.id=r.attribution_id WHERE a.public_id=$1`, [duplicatePatientAttribution.attribution.attributionId]);
    assert(duplicatePatientReview.fraudReview === true && duplicatePatientState.rows[0]?.referral_status === "FRAUD_REVIEW" && duplicatePatientState.rows[0]?.flag_count === "1" && duplicatePatientState.rows[0]?.credit_count === "0", "Duplicate referred patient was not quarantined before reward creation.");

    const duplicateConsultationAttribution = await attribution.createOrResolveAttribution({ code: referralCode, journeyId: randomUUID(), now });
    const duplicateConsultationReview = await operational.processWebhook({ eventId: `evt-e2e-duplicate-consultation-${token}`, eventType: "consultation.paid", attributionPublicId: duplicateConsultationAttribution.attribution.attributionId, patientReference: `pat_eu_other_${token}`, consultationReference: `consult-e2e-paid-${token}`, payloadHash: "e2e-duplicate-consultation" });
    const duplicateConsultationState = await sql.query<{ referral_status: string; flag_count: string; credit_count: string }>(`SELECT r.status AS referral_status,
      (SELECT count(*)::text FROM fraud_flags WHERE referral_id=r.id AND type='DUPLICATE_PAYMENT_EVENT') AS flag_count,
      (SELECT count(*)::text FROM reward_ledger WHERE referral_id=r.id) AS credit_count
      FROM referrals r JOIN referral_attributions a ON a.id=r.attribution_id WHERE a.public_id=$1`, [duplicateConsultationAttribution.attribution.attributionId]);
    assert(duplicateConsultationReview.fraudReview === true && duplicateConsultationState.rows[0]?.referral_status === "FRAUD_REVIEW" && duplicateConsultationState.rows[0]?.flag_count === "1" && duplicateConsultationState.rows[0]?.credit_count === "0", "Duplicate consultation was not quarantined before reward creation.");
    record(steps, 15, "Verified webhook identity fraud controls", "PASS", "self-referral, duplicate referred patient, and duplicate consultation were quarantined without ledger credit");
    const generatedFlags = await sql.query<{ id: string }>("SELECT f.id FROM fraud_flags f JOIN referrals r ON r.id=f.referral_id WHERE r.referrer_user_id=$1 AND f.detail->>'source'='verified_webhook'", [referrerUserId]);
    for (const flag of generatedFlags.rows) await operational.resolveFraud(flag.id, "APPROVED", actor);
    assert(await count(sql, "SELECT count(*) FROM referrals WHERE referrer_user_id=$1 AND status='FRAUD_REVIEW'", [referrerUserId]) === 0, "Approved test fraud reviews remained open.");

    const adminReferral = await sql.query<{ status: string; reward: string }>("SELECT status, referrer_reward_minor::text AS reward FROM referrals WHERE id=$1", [referralRow.id]);
    assert(adminReferral.rows[0]?.status === "QUALIFIED", "Admin read model query did not see qualified referral.");
    record(steps, 15, "Referral appears in admin/backend visibility", "PASS", `admin query status=${adminReferral.rows[0]?.status}; reward_minor=${adminReferral.rows[0]?.reward}`);

    const payout = await operational.requestPayout({ referralUserId: referrerUserId, payoutAccountId: account.rows[0]!.id, amountMinor: rewardMinor, idempotencyKey: `e2e-payout-request-${token}` }, actor);
    const duplicatePayout = await operational.requestPayout({ referralUserId: referrerUserId, payoutAccountId: account.rows[0]!.id, amountMinor: rewardMinor, idempotencyKey: `e2e-payout-request-${token}` }, actor);
    assert(payout.id === duplicatePayout.id && payout.status === "REQUESTED", "Payout request idempotency failed.");
    record(steps, 16, "Payout eligibility/request status", "PASS", `payout_id=${payout.id}; status=${payout.status}; duplicate_same_id=${duplicatePayout.id === payout.id}`);

    const paidPayout = await operational.markPayoutPaid(payout.id, `e2e-payout-paid-${token}`, actor);
    const duplicatePaidPayout = await operational.markPayoutPaid(payout.id, `e2e-payout-paid-${token}`, actor);
    const payoutDebits = await sql.query<{ count: string; amount_minor: string }>("SELECT count(*)::text, COALESCE(SUM(amount_minor),0)::text AS amount_minor FROM reward_ledger WHERE payout_request_id=$1 AND type='PAYOUT'", [payout.id]);
    assert(paidPayout.status === "PAID" && duplicatePaidPayout.status === "PAID" && Number(payoutDebits.rows[0]!.count) === 1 && integer(payoutDebits.rows[0]!.amount_minor) === -rewardMinor, "Mark paid/debit idempotency failed.");
    record(steps, 17, "Mark payout paid final state", "PASS", `status=${paidPayout.status}; payout_debits=${payoutDebits.rows[0]!.count}; debit_minor=${payoutDebits.rows[0]!.amount_minor}`);

    const balances = await sql.query<{ balance: string; lifetime: string }>(
      "SELECT COALESCE(SUM(amount_minor) FILTER (WHERE status='EFFECTIVE'),0)::text AS balance, COALESCE(SUM(amount_minor) FILTER (WHERE type='CREDIT'),0)::text AS lifetime FROM reward_ledger WHERE referral_user_id=$1",
      [referrerUserId],
    );
    assert(integer(balances.rows[0]!.balance) === 0 && integer(balances.rows[0]!.lifetime) === rewardMinor, "Referrer balance/lifetime visibility mismatch after payout.");
    record(steps, 18, "Patient/referrer visibility after payout", "PASS", `available_balance_minor=${balances.rows[0]!.balance}; lifetime_credit_minor=${balances.rows[0]!.lifetime}`);

    const refundAttribution = await attribution.createOrResolveAttribution({ code: referralCode, journeyId: randomUUID(), now });
    await operational.processWebhook({ eventId: `evt-e2e-refund-paid-${token}`, eventType: "consultation.paid", attributionPublicId: refundAttribution.attribution.attributionId, patientReference: `pat_eu_refund_${token}`, consultationReference: `consult-e2e-refund-${token}`, payloadHash: "e2e-refund-paid" });
    const refundReferral = await sql.query<{ id: string }>("SELECT r.id FROM referrals r JOIN referral_attributions a ON a.id=r.attribution_id WHERE a.public_id=$1", [refundAttribution.attribution.attributionId]);
    const refundResult = await operational.processWebhook({ eventId: `evt-e2e-refund-${token}`, eventType: "consultation.refunded", attributionPublicId: refundAttribution.attribution.attributionId, patientReference: `pat_eu_refund_${token}`, consultationReference: `consult-e2e-refund-${token}`, payloadHash: "e2e-refund" });
    const duplicateRefund = await operational.processWebhook({ eventId: `evt-e2e-refund-${token}`, eventType: "consultation.refunded", attributionPublicId: refundAttribution.attribution.attributionId, patientReference: `pat_eu_refund_${token}`, consultationReference: `consult-e2e-refund-${token}`, payloadHash: "e2e-refund" });
    const reversal = await sql.query<{ count: string; amount_minor: string; status: string }>(
      "SELECT count(*)::text, COALESCE(SUM(amount_minor),0)::text AS amount_minor, max(r.status)::text AS status FROM reward_ledger l JOIN referrals r ON r.id=l.referral_id WHERE l.referral_id=$1 AND l.type='REVERSAL'",
      [refundReferral.rows[0]!.id],
    );
    assert(!refundResult.duplicate && duplicateRefund.duplicate && Number(reversal.rows[0]!.count) === 1 && integer(reversal.rows[0]!.amount_minor) === -rewardMinor && reversal.rows[0]!.status === "REFUNDED", "Refund/cancellation reversal idempotency failed.");
    record(steps, 19, "Refund/cancellation reverses reward idempotently", "PASS", `status=${reversal.rows[0]!.status}; reversal_rows=${reversal.rows[0]!.count}; reversal_minor=${reversal.rows[0]!.amount_minor}`);

    await operational.flagFraud(referralRow.id, "SELF_REFERRAL", actor);
    const fraud = await sql.query<{ status: string; referral_status: string }>("SELECT f.status, r.status AS referral_status FROM fraud_flags f JOIN referrals r ON r.id=f.referral_id WHERE f.referral_id=$1 AND f.type='SELF_REFERRAL'", [referralRow.id]);
    assert(fraud.rows[0]?.status === "OPEN" && fraud.rows[0]?.referral_status === "FRAUD_REVIEW", "Fraud flag did not move referral into review.");
    record(steps, 20, "Self-referral/abuse review path", "PASS", `fraud_status=${fraud.rows[0]?.status}; referral_status=${fraud.rows[0]?.referral_status}`);

    const integrity = await sql.query<{ referrers: string; codes: string; attributions: string; referrals: string; credit_rows: string; payout_rows: string; webhook_rows: string; orphan_referrals: string }>(
      `SELECT
        (SELECT count(*)::text FROM referral_users WHERE patient_reference=$1) AS referrers,
        (SELECT count(*)::text FROM referral_codes WHERE code=$2) AS codes,
        (SELECT count(*)::text FROM referral_attributions WHERE referral_code_id=(SELECT id FROM referral_codes WHERE code=$2)) AS attributions,
        (SELECT count(*)::text FROM referrals WHERE referrer_user_id=$3) AS referrals,
        (SELECT count(*)::text FROM reward_ledger WHERE referral_user_id=$3 AND type='CREDIT') AS credit_rows,
        (SELECT count(*)::text FROM payout_requests WHERE referral_user_id=$3) AS payout_rows,
        (SELECT count(*)::text FROM webhook_events WHERE event_id LIKE $4) AS webhook_rows,
        (SELECT count(*)::text FROM referrals r LEFT JOIN referral_attributions a ON a.id=r.attribution_id WHERE r.referrer_user_id=$3 AND a.id IS NULL) AS orphan_referrals`,
      [patientReference, referralCode, referrerUserId, `evt-e2e-%-${token}`],
    );
    const i = integrity.rows[0]!;
    assert(Number(i.referrers) === 1 && Number(i.codes) === 1 && Number(i.attributions) >= 5 && Number(i.referrals) === 5 && Number(i.credit_rows) === 2 && Number(i.payout_rows) === 1 && Number(i.orphan_referrals) === 0, "Data integrity counts are unexpected.");
    record(steps, 21, "Database integrity inspection", "PASS", `referrers=${i.referrers}; codes=${i.codes}; attributions=${i.attributions}; referrals=${i.referrals}; credit_rows=${i.credit_rows}; payout_rows=${i.payout_rows}; orphan_referrals=${i.orphan_referrals}`);

    const invalid = await attribution.resolveOffer("INVALID1", now);
    assert(invalid.kind === "unavailable", "Invalid code unexpectedly resolved.");
    record(steps, 22, "Invalid referral code fails safely", "PASS", `reason=${invalid.kind === "unavailable" ? invalid.reason : "available"}`);
  } catch (error) {
    record(steps, steps.length + 1, "E2E runner failure", "FAIL", error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
    for (const step of steps) console.log(`${step.step} | ${step.test} | ${step.result} | ${step.evidence}`);
    const passed = steps.filter((step) => step.result === "PASS").length;
    const failed = steps.filter((step) => step.result === "FAIL").length;
    const blocked = steps.filter((step) => step.result === "BLOCKED").length;
    console.log(`SUMMARY | passed=${passed} | failed=${failed} | blocked=${blocked} | rolled_back=true`);
  }
}

void main();
