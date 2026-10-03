import "server-only";

import { createHash } from "node:crypto";
import { PostgresOperationalRepository, type FraudDecision, type FraudType } from "@/lib/persistence/operations-postgres";
import { getPostgresExecutor } from "@/lib/persistence/node-postgres";
import type { SqlExecutor } from "@/lib/persistence/postgres";
import type { LedgerEntry, Referral, ReferralStatus } from "@/lib/domain/types";
import type { PatientPortalData, PortalPayoutHistoryItem } from "@/lib/portal/data";
import { buildPatientPortalData } from "@/lib/portal/data";
import { toMinorUnits } from "@/lib/portal/money";
import { buildReferralUrl } from "@/lib/portal/referral-link";
import { referralDemoModeEnabled, requireReferralDemoMode } from "@/lib/demo/config";

export const demoReferralCode = "PH7DEMO";
const demoPatientReference = "demo-review-ava-v1";
const demoAdminEmailHash = createHash("sha256").update("founder-demo@ph7.example").digest("hex");
const demoEmailHash = createHash("sha256").update("ava-demo@ph7.example").digest("hex");

export interface DemoProgramme {
  campaignId: string;
  version: number;
  enabled: boolean;
  friendIncentiveMinor: number;
  referrerRewardMinor: number;
  holdingPeriodDays: number;
  minimumWithdrawalMinor: number;
  qualificationEvent: string;
}

export interface DemoAdminReferral {
  id: string;
  publicAttributionId: string;
  status: ReferralStatus;
  statusBeforeFraudReview: ReferralStatus | null;
  friendLabel: string;
  referrerRewardMinor: number;
  friendIncentiveMinor: number;
  createdAt: Date;
}

export interface DemoPayout {
  id: string;
  amountMinor: number;
  status: string;
  accountMask: string;
  requestedAt: Date;
  paidAt: Date | null;
}

export interface DemoFraudFlag {
  id: string;
  referralId: string;
  type: FraudType;
  status: string;
  createdAt: Date;
}

export interface DemoAuditEvent {
  id: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
  createdAt: Date;
}

export interface DemoAdminData {
  programme: DemoProgramme;
  referralUserId: string;
  payoutAccountId: string;
  metrics: {
    referralCount: number;
    qualifiedCount: number;
    rewardSpendMinor: number;
    outstandingLiabilityMinor: number;
    availableBalanceMinor: number;
    pendingPayoutCount: number;
    referralCacMinor: number;
    rewardRevenueRatio: string;
  };
  funnel: Array<{ status: ReferralStatus; count: number }>;
  referrals: DemoAdminReferral[];
  payouts: DemoPayout[];
  fraudFlags: DemoFraudFlag[];
  audit: DemoAuditEvent[];
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function publicId(seed: string): string {
  return `attr_${createHash("md5").update(seed).digest("hex")}`;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

async function ensureProgramme(tx: SqlExecutor): Promise<DemoProgramme> {
  await tx.query("LOCK TABLE campaigns IN SHARE ROW EXCLUSIVE MODE");
  let campaign = await tx.query<{ id: string; version: number; friend_incentive_minor: number; referrer_reward_minor: number; holding_period_days: number; qualification_event: string }>(
    "SELECT id, version, friend_incentive_minor, referrer_reward_minor, holding_period_days, qualification_event FROM campaigns WHERE is_active=true LIMIT 1 FOR UPDATE",
  );
  if (!campaign.rows[0]) {
    campaign = await tx.query(
      "INSERT INTO campaigns (version,name,is_active,friend_incentive_minor,referrer_reward_minor,holding_period_days) VALUES ((SELECT COALESCE(MAX(version),0)+1 FROM campaigns),'Staging review referral offer',true,1000,1000,14) RETURNING id, version, friend_incentive_minor, referrer_reward_minor, holding_period_days, qualification_event",
    );
  }
  let settings = await tx.query<{ version: number; minimum_withdrawal_minor: number }>(
    "SELECT version, minimum_withdrawal_minor FROM programme_settings WHERE programme_enabled=true ORDER BY version DESC LIMIT 1 FOR UPDATE",
  );
  if (!settings.rows[0]) {
    settings = await tx.query(
      "INSERT INTO programme_settings (version,programme_enabled,minimum_withdrawal_minor) VALUES ((SELECT COALESCE(MAX(version),0)+1 FROM programme_settings),true,1000) RETURNING version, minimum_withdrawal_minor",
    );
  }
  const row = campaign.rows[0]!;
  return {
    campaignId: row.id,
    version: row.version,
    enabled: true,
    friendIncentiveMinor: Number(row.friend_incentive_minor),
    referrerRewardMinor: Number(row.referrer_reward_minor),
    holdingPeriodDays: row.holding_period_days,
    minimumWithdrawalMinor: Number(settings.rows[0]!.minimum_withdrawal_minor),
    qualificationEvent: row.qualification_event,
  };
}

async function ensureDemoUser(tx: SqlExecutor): Promise<{ referralUserId: string; payoutAccountId: string; adminUserId: string }> {
  const user = await tx.query<{ id: string }>(
    "INSERT INTO referral_users (patient_reference,email_hash) VALUES ($1,$2) ON CONFLICT (patient_reference) DO UPDATE SET email_hash=EXCLUDED.email_hash RETURNING id",
    [demoPatientReference, demoEmailHash],
  );
  const referralUserId = user.rows[0]!.id;
  await tx.query(
    "INSERT INTO referral_codes (referral_user_id,code,is_active) VALUES ($1,$2,true) ON CONFLICT (code) DO UPDATE SET referral_user_id=EXCLUDED.referral_user_id,is_active=true,revoked_at=NULL",
    [referralUserId, demoReferralCode],
  );
  const account = await tx.query<{ id: string }>(
    "INSERT INTO payout_accounts (referral_user_id,account_holder_name,iban_encrypted,iban_last4) VALUES ($1,'Synthetic Ava',decode('53594e544845544943','hex'),'T154') RETURNING id",
    [referralUserId],
  );
  const admin = await tx.query<{ id: string }>(
    "INSERT INTO admin_users (email_hash,role) VALUES ($1,'FOUNDER') ON CONFLICT (email_hash) DO UPDATE SET role='FOUNDER' RETURNING id",
    [demoAdminEmailHash],
  );
  return { referralUserId, payoutAccountId: account.rows[0]!.id, adminUserId: admin.rows[0]!.id };
}

async function insertReferralFixture(tx: SqlExecutor, programme: DemoProgramme, referralUserId: string, codeId: string, seed: string, status: ReferralStatus, rewardMinor = programme.referrerRewardMinor): Promise<string> {
  const attr = await tx.query<{ id: string }>(
    `INSERT INTO referral_attributions (referral_code_id,campaign_id,campaign_version,programme_settings_version,friend_incentive_minor,referrer_reward_minor,currency,qualification_event,holding_period_days,reward_cap_minor,public_id,journey_context_hash)
     VALUES ($1,$2,$3,$3,$4,$5,'EUR',$6,$7,NULL,$8,$9)
     ON CONFLICT (public_id) DO NOTHING
     RETURNING id`,
    [codeId, programme.campaignId, programme.version, programme.friendIncentiveMinor, rewardMinor, programme.qualificationEvent, programme.holdingPeriodDays, publicId(seed), digest(`demo:${seed}`)],
  );
  const attrId = attr.rows[0]?.id ?? (await tx.query<{ id: string }>("SELECT id FROM referral_attributions WHERE public_id=$1", [publicId(seed)])).rows[0]!.id;
  const referral = await tx.query<{ id: string }>(
    `INSERT INTO referrals (referrer_user_id,attribution_id,campaign_id,campaign_version,programme_settings_version,friend_incentive_minor,referrer_reward_minor,currency,qualification_event,holding_period_days,reward_cap_minor,status,status_before_fraud_review)
     VALUES ($1,$2,$3,$4,$4,$5,$6,'EUR',$7,$8,NULL,$9::referral_status,CASE WHEN $9::referral_status='FRAUD_REVIEW' THEN 'PAID'::referral_status ELSE NULL END)
     ON CONFLICT (attribution_id) DO UPDATE SET status=referrals.status
     RETURNING id`,
    [referralUserId, attrId, programme.campaignId, programme.version, programme.friendIncentiveMinor, rewardMinor, programme.qualificationEvent, programme.holdingPeriodDays, status],
  );
  return referral.rows[0]!.id;
}

export async function ensureDemoFixture(): Promise<{ referralUserId: string; payoutAccountId: string; adminUserId: string }> {
  requireReferralDemoMode();
  const sql = getPostgresExecutor();
  return sql.transaction(async (tx) => {
    const programme = await ensureProgramme(tx);
    const ids = await ensureDemoUser(tx);
    const code = await tx.query<{ id: string }>("SELECT id FROM referral_codes WHERE code=$1", [demoReferralCode]);
    const codeId = code.rows[0]!.id;
    const registered = await insertReferralFixture(tx, programme, ids.referralUserId, codeId, "registered", "REGISTERED");
    const booked = await insertReferralFixture(tx, programme, ids.referralUserId, codeId, "booked", "BOOKED");
    const paid = await insertReferralFixture(tx, programme, ids.referralUserId, codeId, "paid", "PAID");
    const payable = await insertReferralFixture(tx, programme, ids.referralUserId, codeId, "payable", "PAYABLE");
    const paidOut = await insertReferralFixture(tx, programme, ids.referralUserId, codeId, "paidout", "PAID_OUT");
    const review = await insertReferralFixture(tx, programme, ids.referralUserId, codeId, "self-review", "FRAUD_REVIEW");
    const refund = await insertReferralFixture(tx, programme, ids.referralUserId, codeId, "refund", "REFUNDED");
    await tx.query("INSERT INTO reward_ledger (referral_user_id,referral_id,type,amount_minor,status,idempotency_key,effective_at) VALUES ($1,$2,'CREDIT',$3,'PENDING',$4,NULL) ON CONFLICT (idempotency_key) DO NOTHING", [ids.referralUserId, paid, programme.referrerRewardMinor, "demo:credit:pending"]);
    for (const [referralId, key] of [[payable, "payable"], [paidOut, "paidout"], [refund, "refund"]] as const) {
      await tx.query("INSERT INTO reward_ledger (referral_user_id,referral_id,type,amount_minor,status,idempotency_key,effective_at) VALUES ($1,$2,'CREDIT',$3,'EFFECTIVE',$4,now()) ON CONFLICT (idempotency_key) DO NOTHING", [ids.referralUserId, referralId, programme.referrerRewardMinor, `demo:credit:${key}`]);
    }
    await tx.query("INSERT INTO reward_ledger (referral_user_id,referral_id,type,amount_minor,status,idempotency_key,effective_at) VALUES ($1,$2,'REVERSAL',$3,'EFFECTIVE',$4,now()) ON CONFLICT (idempotency_key) DO NOTHING", [ids.referralUserId, refund, -programme.referrerRewardMinor, "demo:reversal:refund"]);
    const existingPayout = await tx.query<{ id: string }>("SELECT id FROM payout_requests WHERE idempotency_key='demo:payout:paid'");
    if (!existingPayout.rows[0]) {
      const payout = await tx.query<{ id: string }>("INSERT INTO payout_requests (referral_user_id,payout_account_id,amount_minor,status,idempotency_key,paid_at) VALUES ($1,$2,$3,'PAID','demo:payout:paid',now()) RETURNING id", [ids.referralUserId, ids.payoutAccountId, programme.referrerRewardMinor]);
      await tx.query("INSERT INTO reward_ledger (referral_user_id,payout_request_id,type,amount_minor,status,idempotency_key,effective_at) VALUES ($1,$2,'PAYOUT',$3,'EFFECTIVE','demo:payout:ledger:paid',now()) ON CONFLICT (idempotency_key) DO NOTHING", [ids.referralUserId, payout.rows[0]!.id, -programme.referrerRewardMinor]);
    }
    await tx.query("INSERT INTO fraud_flags (referral_id,type,status,detail) VALUES ($1,'SELF_REFERRAL','OPEN',$2::jsonb) ON CONFLICT DO NOTHING", [review, JSON.stringify({ demo: true, reason: "Synthetic self-referral example" })]);
    await tx.query("INSERT INTO fraud_flags (referral_id,type,status,detail) VALUES ($1,'DUPLICATE_REFERRED_USER','INVESTIGATING',$2::jsonb) ON CONFLICT DO NOTHING", [booked, JSON.stringify({ demo: true, reason: "Synthetic duplicate referred-user example" })]);
    await tx.query("INSERT INTO fraud_flags (referral_id,type,status,detail) VALUES ($1,'REFUNDED_CONSULTATION','APPROVED',$2::jsonb) ON CONFLICT DO NOTHING", [refund, JSON.stringify({ demo: true, reason: "Synthetic refund/reversal example" })]);
    await tx.query("INSERT INTO admin_audit_log (admin_user_id,action,subject_type,subject_id,request_id) VALUES ($1,'DEMO_FIXTURE_READY','demo',$2,'demo-seed')", [ids.adminUserId, ids.referralUserId]);
    void registered;
    return ids;
  });
}

async function demoIds(): Promise<{ referralUserId: string; payoutAccountId: string; adminUserId: string }> {
  return referralDemoModeEnabled() ? ensureDemoFixture() : Promise.reject(new Error("Referral demo mode is not enabled."));
}

export async function getDemoPortalData(): Promise<PatientPortalData> {
  const { referralUserId } = await demoIds();
  const sql = getPostgresExecutor();
  const referrals = await sql.query<{
    id: string; public_id: string; status: ReferralStatus; status_before_fraud_review: ReferralStatus | null; campaign_id: string; campaign_version: number; programme_settings_version: number; friend_incentive_minor: number; referrer_reward_minor: number; currency: "EUR"; qualification_event: "consultation.paid"; holding_period_days: number; reward_cap_minor: number | null; created_at: Date | string; updated_at: Date | string;
  }>(
    `SELECT r.*, a.public_id FROM referrals r JOIN referral_attributions a ON a.id=r.attribution_id WHERE r.referrer_user_id=$1 ORDER BY r.created_at DESC`,
    [referralUserId],
  );
  const referralModels: PatientPortalData["referrals"] = referrals.rows.map((row, index) => ({
    id: row.id,
    referrerUserId: referralUserId,
    attributionId: row.public_id,
    status: row.status,
    statusBeforeFraudReview: row.status_before_fraud_review,
    patientLabel: `Synthetic friend ${index + 1}`,
    economics: Object.freeze({
      campaignId: row.campaign_id,
      campaignVersion: row.campaign_version,
      programmeSettingsVersion: row.programme_settings_version,
      friendIncentiveMinor: Number(row.friend_incentive_minor),
      referrerRewardMinor: Number(row.referrer_reward_minor),
      currency: row.currency,
      qualificationEvent: row.qualification_event,
      holdingPeriodDays: row.holding_period_days,
      rewardCapMinor: row.reward_cap_minor === null ? null : Number(row.reward_cap_minor),
      capturedAt: asDate(row.created_at),
    }),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }));
  const ledger = await sql.query<LedgerEntry>("SELECT id, referral_id AS \"referralId\", payout_request_id AS \"payoutRequestId\", type, amount_minor AS \"amountMinor\", currency, status, idempotency_key AS \"idempotencyKey\", effective_at AS \"effectiveAt\", created_at AS \"createdAt\" FROM reward_ledger WHERE referral_user_id=$1 ORDER BY created_at", [referralUserId]);
  const ledgerRows = ledger.rows.map((row) => ({
    ...row,
    amountMinor: toMinorUnits(row.amountMinor, "portal ledger amount"),
    effectiveAt: row.effectiveAt ? asDate(row.effectiveAt) : null,
    createdAt: asDate(row.createdAt),
  }));
  const payouts = await sql.query<{ id: string; amount_minor: number; status: string; requested_at: Date | string; paid_at: Date | string | null; iban_last4: string }>("SELECT p.id, p.amount_minor, p.status, p.requested_at, p.paid_at, a.iban_last4 FROM payout_requests p JOIN payout_accounts a ON a.id=p.payout_account_id WHERE p.referral_user_id=$1 ORDER BY p.created_at DESC", [referralUserId]);
  const programme = await currentProgramme(sql);
  const totals = buildPatientPortalData(referralModels, ledgerRows);
  return {
    ...totals,
    syntheticPatientName: "Ava (staging patient)",
    displayName: "Ava",
    environmentLabel: "Staging demo",
    referralCode: demoReferralCode,
    referralUrl: buildReferralUrl(demoReferralCode),
    friendIncentiveMinor: programme.friendIncentiveMinor,
    holdingPeriodDays: programme.holdingPeriodDays,
    minimumWithdrawalMinor: programme.minimumWithdrawalMinor,
    payouts: payouts.rows.map((row) => ({ id: row.id, amountMinor: Number(row.amount_minor), status: row.status as PortalPayoutHistoryItem["status"], requestedAt: asDate(row.requested_at), paidAt: row.paid_at ? asDate(row.paid_at) : null, accountMask: `TEST ${row.iban_last4}` })),
  };
}

export async function currentProgramme(sql = getPostgresExecutor()): Promise<DemoProgramme> {
  const row = await sql.query<{ id: string; version: number; is_active: boolean; friend_incentive_minor: number; referrer_reward_minor: number; holding_period_days: number; qualification_event: string; minimum_withdrawal_minor: number }>(
    `SELECT c.id, c.version, c.is_active, c.friend_incentive_minor, c.referrer_reward_minor, c.holding_period_days, c.qualification_event,
      COALESCE((SELECT minimum_withdrawal_minor FROM programme_settings WHERE programme_enabled ORDER BY version DESC LIMIT 1),0) AS minimum_withdrawal_minor
     FROM campaigns c WHERE c.is_active=true LIMIT 1`,
  );
  if (!row.rows[0]) throw new Error("No active programme is configured.");
  const value = row.rows[0]!;
  return { campaignId: value.id, version: value.version, enabled: value.is_active, friendIncentiveMinor: Number(value.friend_incentive_minor), referrerRewardMinor: Number(value.referrer_reward_minor), holdingPeriodDays: value.holding_period_days, minimumWithdrawalMinor: Number(value.minimum_withdrawal_minor), qualificationEvent: value.qualification_event };
}

export async function getDemoAdminData(): Promise<DemoAdminData> {
  const { referralUserId, payoutAccountId } = await demoIds();
  const sql = getPostgresExecutor();
  const [programme, referrals, payouts, flags, audit, funnel, ledger, pendingPayout] = await Promise.all([
    currentProgramme(sql),
    sql.query<DemoAdminReferral & { friend_incentive_minor: number; referrer_reward_minor: number; public_id: string; created_at: Date | string }>(
      `SELECT r.id, a.public_id AS "publicAttributionId", r.status, r.status_before_fraud_review AS "statusBeforeFraudReview", r.friend_incentive_minor, r.referrer_reward_minor, r.created_at
       FROM referrals r JOIN referral_attributions a ON a.id=r.attribution_id WHERE r.referrer_user_id=$1 ORDER BY r.created_at DESC`,
      [referralUserId],
    ),
    sql.query<{ id: string; amount_minor: number; status: string; iban_last4: string; requested_at: Date | string; paid_at: Date | string | null }>(
      "SELECT p.id, p.amount_minor, p.status, a.iban_last4, p.requested_at, p.paid_at FROM payout_requests p JOIN payout_accounts a ON a.id=p.payout_account_id WHERE p.referral_user_id=$1 ORDER BY p.created_at DESC",
      [referralUserId],
    ),
    sql.query<DemoFraudFlag & { created_at: Date | string }>(
      "SELECT f.id, f.referral_id AS \"referralId\", f.type, f.status, f.created_at FROM fraud_flags f JOIN referrals r ON r.id=f.referral_id WHERE r.referrer_user_id=$1 ORDER BY f.created_at DESC",
      [referralUserId],
    ),
    new PostgresOperationalRepository(sql).auditHistory(50),
    sql.query<{ status: ReferralStatus; count: string }>("SELECT status, count(*)::text AS count FROM referrals WHERE referrer_user_id=$1 GROUP BY status ORDER BY status", [referralUserId]),
    sql.query<{ credit: string; liability: string; balance: string }>(
      "SELECT COALESCE(SUM(amount_minor) FILTER (WHERE type='CREDIT'),0)::text AS credit, COALESCE(SUM(amount_minor) FILTER (WHERE status='PENDING'),0)::text AS liability, COALESCE(SUM(amount_minor) FILTER (WHERE status='EFFECTIVE'),0)::text AS balance FROM reward_ledger WHERE referral_user_id=$1",
      [referralUserId],
    ),
    sql.query<{ count: string }>("SELECT count(*)::text AS count FROM payout_requests WHERE referral_user_id=$1 AND status='REQUESTED'", [referralUserId]),
  ]);
  const qualifiedCount = funnel.rows.filter((row) => ["QUALIFIED", "PAYABLE", "PAID_OUT"].includes(row.status)).reduce((sum, row) => sum + Number(row.count), 0);
  const referralCount = funnel.rows.reduce((sum, row) => sum + Number(row.count), 0);
  const rewardSpendMinor = Number(ledger.rows[0]?.credit ?? 0);
  const syntheticRevenueMinor = qualifiedCount * 12500;
  return {
    programme,
    referralUserId,
    payoutAccountId,
    metrics: {
      referralCount,
      qualifiedCount,
      rewardSpendMinor,
      outstandingLiabilityMinor: Number(ledger.rows[0]?.liability ?? 0),
      availableBalanceMinor: Number(ledger.rows[0]?.balance ?? 0),
      pendingPayoutCount: Number(pendingPayout.rows[0]?.count ?? 0),
      referralCacMinor: qualifiedCount > 0 ? Math.round(rewardSpendMinor / qualifiedCount) : 0,
      rewardRevenueRatio: syntheticRevenueMinor > 0 ? `${(rewardSpendMinor / syntheticRevenueMinor * 100).toFixed(1)}%` : "n/a",
    },
    funnel: funnel.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
    referrals: referrals.rows.map((row, index) => ({ id: row.id, publicAttributionId: row.publicAttributionId, status: row.status, statusBeforeFraudReview: row.statusBeforeFraudReview, friendLabel: `Synthetic friend ${index + 1}`, friendIncentiveMinor: Number(row.friend_incentive_minor), referrerRewardMinor: Number(row.referrer_reward_minor), createdAt: asDate(row.created_at) })),
    payouts: payouts.rows.map((row) => ({ id: row.id, amountMinor: Number(row.amount_minor), status: row.status, accountMask: `TEST ${row.iban_last4}`, requestedAt: asDate(row.requested_at), paidAt: row.paid_at ? asDate(row.paid_at) : null })),
    fraudFlags: flags.rows.map((row) => ({ ...row, createdAt: asDate(row.created_at) })),
    audit,
  };
}

export async function demoActor() {
  const { adminUserId } = await demoIds();
  return { adminUserId, role: "FOUNDER" as const, requestId: `demo-${Date.now()}` };
}

export async function demoPayoutInput(amountMinor: number) {
  const { referralUserId, payoutAccountId } = await demoIds();
  return { referralUserId, payoutAccountId, amountMinor, idempotencyKey: `demo:payout:request:${amountMinor}` };
}
