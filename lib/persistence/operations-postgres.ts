import "server-only";

import { randomUUID } from "node:crypto";
import { LedgerService } from "@/lib/domain/services/ledger";
import { ReferralLifecycleService } from "@/lib/domain/services/referral-lifecycle";
import { PostgresDomainRepository } from "@/lib/persistence/domain-postgres";
import type { ReferralStatus } from "@/lib/domain/types";
import type { SqlExecutor } from "@/lib/persistence/postgres";

export type FraudType = "SELF_REFERRAL" | "DUPLICATE_REFERRED_USER" | "SAME_DEVICE" | "SUSPICIOUS_IP" | "HIGH_VELOCITY" | "REFUNDED_CONSULTATION" | "DUPLICATE_PAYMENT_EVENT" | "MANUAL_FLAG";
export type FraudDecision = "APPROVED" | "REJECTED" | "INVESTIGATING";
export interface RuntimeCampaign { id: string; version: number; active: boolean; friendIncentiveMinor: number; referrerRewardMinor: number; holdingPeriodDays: number; }
export interface OperationalAuditActor { readonly adminUserId: string; readonly requestId?: string; }
export interface PayoutRequestCommand {
  referralUserId: string; amountMinor: number; idempotencyKey: string;
  payoutAccountId?: string;
  bankDetails?: { accountHolderName: string; ibanEncrypted: Buffer; ibanLast4: string };
  enforceProgrammeRules?: boolean;
}

export class PostgresOperationalRepository {
  constructor(private readonly sql: SqlExecutor) {}
  async activeCampaign(): Promise<RuntimeCampaign | null> { const r = await this.sql.query<{ id: string; version: number; is_active: boolean; friend_incentive_minor: number; referrer_reward_minor: number; holding_period_days: number }>("SELECT id, version, is_active, friend_incentive_minor, referrer_reward_minor, holding_period_days FROM campaigns WHERE is_active LIMIT 1"); const row = r.rows[0]; return row ? { id: row.id, version: row.version, active: row.is_active, friendIncentiveMinor: row.friend_incentive_minor, referrerRewardMinor: row.referrer_reward_minor, holdingPeriodDays: row.holding_period_days } : null; }
  async setCampaign(input: { friendIncentiveMinor: number; referrerRewardMinor: number; active: boolean; holdingPeriodDays?: number }, actor?: OperationalAuditActor): Promise<RuntimeCampaign> {
    if (!Number.isSafeInteger(input.friendIncentiveMinor) || !Number.isSafeInteger(input.referrerRewardMinor) || input.friendIncentiveMinor < 0 || input.referrerRewardMinor < 0) throw new Error("Invalid campaign economics.");
    return this.sql.transaction(async (tx) => {
      await tx.query("LOCK TABLE campaigns IN SHARE ROW EXCLUSIVE MODE");
      const old = await tx.query<{ id: string; version: number; is_active: boolean; friend_incentive_minor: number; referrer_reward_minor: number; holding_period_days: number }>("SELECT id,version,is_active,friend_incentive_minor,referrer_reward_minor,holding_period_days FROM campaigns ORDER BY version DESC LIMIT 1 FOR UPDATE");
      const version = (old.rows[0]?.version ?? 0) + 1;
      const holding = input.holdingPeriodDays ?? old.rows[0]?.holding_period_days ?? 0;
      await tx.query("UPDATE campaigns SET is_active=false WHERE is_active");
      const created = await tx.query<{ id: string }>("INSERT INTO campaigns(version,name,is_active,friend_incentive_minor,referrer_reward_minor,holding_period_days) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [version,`Referral programme v${version}`,input.active,input.friendIncentiveMinor,input.referrerRewardMinor,holding]);
      // A new offer must not silently reset the existing withdrawal policy.
      await tx.query(`INSERT INTO programme_settings(version,programme_enabled,minimum_withdrawal_minor)
        VALUES ((SELECT COALESCE(MAX(version),0)+1 FROM programme_settings),$1,
        COALESCE((SELECT minimum_withdrawal_minor FROM programme_settings ORDER BY version DESC LIMIT 1),0))`, [input.active]);
      await this.audit(tx,"PROGRAMME_UPDATED","campaign",created.rows[0].id,actor,
        old.rows[0] ? { version:old.rows[0].version, active:old.rows[0].is_active, friendIncentiveMinor:Number(old.rows[0].friend_incentive_minor), referrerRewardMinor:Number(old.rows[0].referrer_reward_minor), holdingPeriodDays:old.rows[0].holding_period_days } : null,
        { version, active:input.active, friendIncentiveMinor:input.friendIncentiveMinor, referrerRewardMinor:input.referrerRewardMinor, holdingPeriodDays:holding });
      return {id:created.rows[0].id,version,active:input.active,friendIncentiveMinor:input.friendIncentiveMinor,referrerRewardMinor:input.referrerRewardMinor,holdingPeriodDays:holding};
    });
  }
  async requestPayout(input: PayoutRequestCommand, actor?: OperationalAuditActor) {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !input.idempotencyKey) throw new Error("Payout amount is unavailable.");
    for (let attempt = 0; ; attempt++) {
      try { return await this.sql.transaction(async tx => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.referralUserId]);
        const existing = await tx.query<{ id: string; status: string; referral_user_id: string; amount_minor: string; payout_account_id: string }>("SELECT id,status,referral_user_id,amount_minor,payout_account_id FROM payout_requests WHERE idempotency_key=$1", [input.idempotencyKey]);
        if (existing.rows[0]) {
          if (existing.rows[0].referral_user_id !== input.referralUserId || Number(existing.rows[0].amount_minor) !== input.amountMinor) throw new Error("Payout request does not match.");
          const account=(await tx.query<{iban_last4:string}>("SELECT iban_last4 FROM payout_accounts WHERE id=$1 AND referral_user_id=$2",[existing.rows[0].payout_account_id,input.referralUserId])).rows[0];
          if (!account) throw new Error("Payout account is unavailable.");
          return { id: existing.rows[0].id, status: existing.rows[0].status, accountMask:`•••• ${account.iban_last4}` };
        }
        if (input.enforceProgrammeRules) {
          const settings = (await tx.query<{ programme_enabled: boolean; minimum_withdrawal_minor: string }>("SELECT programme_enabled,minimum_withdrawal_minor FROM programme_settings ORDER BY version DESC LIMIT 1")).rows[0];
          if (!settings?.programme_enabled || Number(settings.minimum_withdrawal_minor) <= 0 || input.amountMinor < Number(settings.minimum_withdrawal_minor)) throw new Error("Withdrawals are unavailable or below the minimum.");
          const review = await tx.query("SELECT id FROM referrals WHERE referrer_user_id=$1 AND status='FRAUD_REVIEW' LIMIT 1", [input.referralUserId]);
          if (review.rows[0]) throw new Error("Withdrawal requires review.");
        }
        const balance = await tx.query<{ balance: string }>(`SELECT
          COALESCE((SELECT SUM(amount_minor) FROM reward_ledger WHERE referral_user_id=$1 AND status='EFFECTIVE'),0)
          - COALESCE((SELECT SUM(amount_minor) FROM payout_requests WHERE referral_user_id=$1 AND status='REQUESTED'),0) AS balance`, [input.referralUserId]);
        if (input.amountMinor > Number(balance.rows[0].balance)) throw new Error("Payout amount is unavailable.");
        let accountId = input.payoutAccountId;
        let accountMask: string;
        if (input.bankDetails) {
          const bank = input.bankDetails;
          accountId = (await tx.query<{ id: string }>("INSERT INTO payout_accounts(referral_user_id,account_holder_name,iban_encrypted,iban_last4) VALUES ($1,$2,$3,$4) RETURNING id", [input.referralUserId, bank.accountHolderName, bank.ibanEncrypted, bank.ibanLast4])).rows[0].id;
          accountMask=`•••• ${bank.ibanLast4}`;
          await this.audit(tx, "PAYOUT_DETAILS_SAVED", "payout_account", accountId, actor);
        } else {
          const account = await tx.query<{iban_last4:string}>("SELECT id,iban_last4 FROM payout_accounts WHERE id=$1 AND referral_user_id=$2", [accountId, input.referralUserId]);
          if (!account.rows[0]) throw new Error("Payout account is unavailable.");
          accountMask=`•••• ${account.rows[0].iban_last4}`;
        }
        const payout = (await tx.query<{ id: string; status: string }>("INSERT INTO payout_requests(referral_user_id,payout_account_id,amount_minor,idempotency_key) VALUES ($1,$2,$3,$4) RETURNING id,status", [input.referralUserId, accountId, input.amountMinor, input.idempotencyKey])).rows[0];
        await this.audit(tx, "PAYOUT_REQUESTED", "payout_request", payout.id, actor);
        return {...payout,accountMask};
      }); } catch (error) {
        if (attempt >= 3 || !["40001", "40P01"].includes((error as { code?: string }).code ?? "")) throw error;
      }
    }
  }
  async markPayoutPaid(payoutId: string, idempotencyKey: string, actor?: OperationalAuditActor) {
    for (let attempt=0; ; attempt++) {
      try { return await this.sql.transaction(async tx => {
        const row = (await tx.query<{referral_user_id:string;amount_minor:string;status:string}>("SELECT referral_user_id,amount_minor,status FROM payout_requests WHERE id=$1 FOR UPDATE",[payoutId])).rows[0];
        if (!row) throw new Error("Payout does not exist.");
        if (row.status === "PAID") return {id:payoutId,status:row.status};
        if (row.status !== "REQUESTED") throw new Error("Payout cannot be marked paid.");
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[row.referral_user_id]);
        if ((await tx.query("SELECT id FROM referrals WHERE referrer_user_id=$1 AND status='FRAUD_REVIEW' LIMIT 1",[row.referral_user_id])).rows[0]) throw new Error("Payout requires fraud review.");
        const balance = (await tx.query<{balance:string}>("SELECT COALESCE(SUM(amount_minor),0)::text AS balance FROM reward_ledger WHERE referral_user_id=$1 AND status='EFFECTIVE'",[row.referral_user_id])).rows[0];
        if (Number(row.amount_minor) > Number(balance.balance)) throw new Error("Payout balance is unavailable.");
        const debit = await tx.query<{id:string}>("INSERT INTO reward_ledger(referral_user_id,payout_request_id,type,amount_minor,idempotency_key) VALUES ($1,$2,'PAYOUT',$3,$4) ON CONFLICT DO NOTHING RETURNING id",[row.referral_user_id,payoutId,-Number(row.amount_minor),idempotencyKey]);
        if (!debit.rows[0]) throw new Error("Payout debit could not be recorded.");
        await tx.query("UPDATE payout_requests SET status='PAID',paid_at=now() WHERE id=$1",[payoutId]);
        await this.audit(tx,"PAYOUT_PAID","payout_request",payoutId,actor);
        return {id:payoutId,status:"PAID"};
      }); } catch(error) {
        if (attempt>=3 || !["40001","40P01"].includes((error as {code?:string}).code ?? "")) throw error;
      }
    }
  }
  async flagFraud(referralId: string, type: FraudType, actor?: OperationalAuditActor) { return this.sql.transaction(async (tx) => { const referral = new PostgresDomainRepository(tx); const current = await referral.findReferral(referralId); if (!current) throw new Error("Referral does not exist."); const existing = await tx.query<{ id: string; status: string }>("SELECT id,status FROM fraud_flags WHERE referral_id = $1 AND type = $2 AND status <> 'REJECTED' FOR UPDATE", [referralId, type]); if (existing.rows[0]) return existing.rows[0]; const lifecycle = new ReferralLifecycleService({ transaction: async (work) => work(referral) }); await lifecycle.transitionInTransaction(referral, { referralId, toStatus: "FRAUD_REVIEW", source: "SYSTEM", idempotencyKey: `fraud:${referralId}:${type}` }); const flag = await tx.query<{ id: string; status: string }>("INSERT INTO fraud_flags (referral_id,type) VALUES ($1,$2) RETURNING id,status", [referralId, type]); await this.audit(tx, "FRAUD_FLAGGED", "fraud_flag", flag.rows[0].id, actor); return flag.rows[0]; }); }
  async resolveFraud(flagId: string, decision: FraudDecision, actor?: OperationalAuditActor) {
    return this.sql.transaction(async tx => {
      const flag=(await tx.query<{referral_id:string}>("SELECT referral_id FROM fraud_flags WHERE id=$1 FOR UPDATE",[flagId])).rows[0];
      if (!flag) throw new Error("Fraud flag does not exist.");
      const repo=new PostgresDomainRepository(tx);
      const value=await repo.findReferral(flag.referral_id);
      if (!value) throw new Error("Referral does not exist.");
      const target:ReferralStatus|null=decision==="APPROVED"?value.statusBeforeFraudReview:decision==="REJECTED"?"REJECTED":null;
      if(target && value.status==="FRAUD_REVIEW") {
        const lifecycle=new ReferralLifecycleService({transaction:async work=>work(repo)});
        await lifecycle.transitionInTransaction(repo,{referralId:value.id,toStatus:target,source:"MANUAL",idempotencyKey:`fraud-resolution:${flagId}:${decision}`});
      }
      await tx.query("UPDATE fraud_flags SET status=$2::fraud_flag_status,resolved_by_admin_user_id=$3,resolved_at=CASE WHEN $2::fraud_flag_status IN ('APPROVED','REJECTED') THEN now() ELSE NULL END WHERE id=$1",[flagId,decision,actor?.adminUserId ?? null]);
      await this.audit(tx,`FRAUD_${decision}`,"fraud_flag",flagId,actor);
      return {id:flagId,status:decision};
    });
  }
  /**
   * Read-only: the friend incentive snapshotted on an attribution when the
   * friend followed the referral link. Never consults the current campaign, so
   * later admin changes cannot alter an existing referral's economics.
   */
  async resolveAttributionIncentive(attributionPublicId: string, patientReference: string): Promise<
    | { status: "ok"; friendIncentiveMinor: number; currency: "EUR" }
    | { status: "unknown" }
    | { status: "self_referral" }
  > {
    const result = await this.sql.query<{ friend_incentive_minor: number | string; currency: "EUR"; referrer_patient_reference: string | null }>(
      "SELECT a.friend_incentive_minor, a.currency, ru.patient_reference AS referrer_patient_reference FROM referral_attributions a JOIN referral_codes rc ON rc.id=a.referral_code_id JOIN referral_users ru ON ru.id=rc.referral_user_id WHERE a.public_id=$1",
      [attributionPublicId],
    );
    const row = result.rows[0];
    if (!row) return { status: "unknown" };
    if (row.referrer_patient_reference === patientReference) return { status: "self_referral" };
    return { status: "ok", friendIncentiveMinor: Number(row.friend_incentive_minor), currency: row.currency };
  }
  async processWebhook(input: { eventId: string; eventType: "consultation.paid" | "consultation.refunded"; attributionPublicId: string; patientReference: string; consultationReference: string; payloadHash?: string }) {
    return this.sql.transaction(async (tx) => {
      const claimed = await tx.query<{ event_id: string }>(
        "INSERT INTO webhook_events (event_id,event_type,payload_hash) VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
        [input.eventId, input.eventType, input.payloadHash ?? "verified-webhook"],
      );
      if (!claimed.rows[0]) return { duplicate: true, unknownAttribution: false };
      const source = await tx.query<{ attribution_id: string; referrer_user_id: string; referrer_patient_reference: string; campaign_id: string; campaign_version: number; programme_settings_version: number; friend_incentive_minor: number; referrer_reward_minor: number; currency: "EUR"; qualification_event: "consultation.paid"; holding_period_days: number; reward_cap_minor: number | null }>(
        "SELECT a.id AS attribution_id, rc.referral_user_id AS referrer_user_id, ru.patient_reference AS referrer_patient_reference, a.campaign_id, a.campaign_version, a.programme_settings_version, a.friend_incentive_minor, a.referrer_reward_minor, a.currency, a.qualification_event, a.holding_period_days, a.reward_cap_minor FROM referral_attributions a JOIN referral_codes rc ON rc.id=a.referral_code_id JOIN referral_users ru ON ru.id=rc.referral_user_id WHERE a.public_id=$1",
        [input.attributionPublicId],
      );
      const row = source.rows[0];
      if (!row) {
        await tx.query("UPDATE webhook_events SET processed_at=now() WHERE event_id=$1", [input.eventId]);
        return { duplicate: false, unknownAttribution: true };
      }
      // Serialize identities supplied by the trusted pH7 backend before checking
      // uniqueness. This prevents concurrent, differently identified events from
      // racing past the fraud checks and lets the second delivery fail closed.
      const identityLocks = [`consultation:${input.consultationReference}`, `patient:${input.patientReference}`].sort();
      for (const identity of identityLocks) await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [identity]);
      const conflicts = await tx.query<{ attribution_id: string; same_patient: boolean; same_consultation: boolean }>(
        `SELECT attribution_id,
          referred_patient_reference=$1 AS same_patient,
          consultation_reference=$2 AS same_consultation
        FROM referrals
        WHERE (referred_patient_reference=$1 OR consultation_reference=$2)
          AND attribution_id<>$3
        FOR UPDATE`,
        [input.patientReference, input.consultationReference, row.attribution_id],
      );
      let duplicatePatient = conflicts.rows.some((conflict) => conflict.same_patient);
      let duplicateConsultation = conflicts.rows.some((conflict) => conflict.same_consultation);
      const selfReferral = input.patientReference === row.referrer_patient_reference;
      await tx.query(
        "INSERT INTO referrals (referrer_user_id,attribution_id,referred_patient_reference,consultation_reference,campaign_id,campaign_version,programme_settings_version,friend_incentive_minor,referrer_reward_minor,currency,qualification_event,holding_period_days,reward_cap_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (attribution_id) DO NOTHING",
        [row.referrer_user_id,row.attribution_id,duplicatePatient ? null : input.patientReference,duplicateConsultation ? null : input.consultationReference,row.campaign_id,row.campaign_version,row.programme_settings_version,row.friend_incentive_minor,row.referrer_reward_minor,row.currency,row.qualification_event,row.holding_period_days,row.reward_cap_minor],
      );
      const stored = (await tx.query<{ id: string; referred_patient_reference: string | null; consultation_reference: string | null }>("SELECT id,referred_patient_reference,consultation_reference FROM referrals WHERE attribution_id=$1 FOR UPDATE", [row.attribution_id])).rows[0]!;
      duplicatePatient ||= stored.referred_patient_reference !== null && stored.referred_patient_reference !== input.patientReference;
      duplicateConsultation ||= stored.consultation_reference !== null && stored.consultation_reference !== input.consultationReference;
      if (!duplicatePatient && !duplicateConsultation && (stored.referred_patient_reference === null || stored.consultation_reference === null)) {
        await tx.query("UPDATE referrals SET referred_patient_reference=COALESCE(referred_patient_reference,$2),consultation_reference=COALESCE(consultation_reference,$3) WHERE id=$1", [stored.id, input.patientReference, input.consultationReference]);
      }
      const referralId = stored.id;
      const repo = new PostgresDomainRepository(tx);
      const lifecycle = new ReferralLifecycleService({ transaction: async (work) => work(repo) });
      const ledger = new LedgerService({ transaction: async (work) => work(repo) });
      const current = await repo.findReferral(referralId);
      if (!current) throw new Error("Referral is unavailable.");
      const fraudTypes: FraudType[] = [];
      if (selfReferral) fraudTypes.push("SELF_REFERRAL");
      if (duplicatePatient) fraudTypes.push("DUPLICATE_REFERRED_USER");
      if (duplicateConsultation) fraudTypes.push("DUPLICATE_PAYMENT_EVENT");
      for (const type of fraudTypes) await this.flagWebhookFraud(tx, referralId, type);
      if (fraudTypes.length > 0) {
        await tx.query("UPDATE webhook_events SET processed_at=now() WHERE event_id=$1", [input.eventId]);
        await this.audit(tx,"WEBHOOK_REVIEW_REQUIRED","webhook", referralId, undefined, null, { fraudTypes });
        return { duplicate: false, unknownAttribution: false, fraudReview: true };
      }
      if (input.eventType === "consultation.paid") {
        const order: ReferralStatus[] = ["VISITED", "ATTRIBUTED", "REGISTERED", "BOOKED", "PAID", "QUALIFIED", "PAYABLE", "PAID_OUT", "CANCELLED", "REFUNDED", "REJECTED", "FRAUD_REVIEW", "EXPIRED"];
        for (const status of ["REGISTERED", "BOOKED", "PAID"] as const) {
          const refreshed = await repo.findReferral(referralId);
          if (!refreshed || order.indexOf(refreshed.status) >= order.indexOf(status)) continue;
          await lifecycle.transitionInTransaction(repo, { referralId, toStatus: status, source: "WEBHOOK", idempotencyKey: `webhook:${input.eventId}:${status}` });
        }
        const paid = await repo.findReferral(referralId);
        if (paid?.status === "PAID") {
          await lifecycle.transitionInTransaction(repo, { referralId, toStatus: "QUALIFIED", source: "WEBHOOK", idempotencyKey: `webhook:${input.eventId}:QUALIFIED` });
          await ledger.postInTransaction(repo, { referralId, type: "CREDIT", amountMinor: paid.economics.referrerRewardMinor, idempotencyKey: `webhook:${input.eventId}:CREDIT` });
        }
      } else if (["PAID","QUALIFIED","PAYABLE"].includes(current.status)) {
        await lifecycle.transitionInTransaction(repo, { referralId, toStatus: "REFUNDED", source: "WEBHOOK", idempotencyKey: `webhook:${input.eventId}:REFUNDED` });
        const credit = await tx.query<{ amount_minor: number }>("SELECT amount_minor FROM reward_ledger WHERE referral_id=$1 AND type='CREDIT' AND status='EFFECTIVE' LIMIT 1", [referralId]);
        if (credit.rows[0]) await ledger.postInTransaction(repo, { referralId, type: "REVERSAL", amountMinor: -Number(credit.rows[0].amount_minor), idempotencyKey: `webhook:${input.eventId}:REVERSAL` });
      }
      await tx.query("UPDATE webhook_events SET processed_at=now() WHERE event_id=$1", [input.eventId]);
      await this.audit(tx,"WEBHOOK_PROCESSED","webhook", referralId);
      return { duplicate: false, unknownAttribution: false };
    });
  }
  async auditHistory(limit = 100) { const result = await this.sql.query<{ id: string; action: string; subject_type: string; subject_id: string | null; created_at: Date | string }>("SELECT id, action, subject_type, subject_id, created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT $1", [limit]); return result.rows.map((row) => ({ id: row.id, action: row.action, subjectType: row.subject_type, subjectId: row.subject_id, createdAt: new Date(row.created_at) })); }
  private async flagWebhookFraud(tx: SqlExecutor, referralId: string, type: FraudType): Promise<void> {
    const existing = await tx.query<{ id: string }>("SELECT id FROM fraud_flags WHERE referral_id=$1 AND type=$2 AND status<>'REJECTED' FOR UPDATE", [referralId, type]);
    if (existing.rows[0]) return;
    const repo = new PostgresDomainRepository(tx);
    const current = await repo.findReferral(referralId);
    if (!current) throw new Error("Referral does not exist.");
    if (current.status !== "FRAUD_REVIEW") {
      const lifecycle = new ReferralLifecycleService({ transaction: async (work) => work(repo) });
      await lifecycle.transitionInTransaction(repo, { referralId, toStatus: "FRAUD_REVIEW", source: "SYSTEM", idempotencyKey: `fraud:${referralId}:${type}` });
    }
    const flag = await tx.query<{ id: string }>("INSERT INTO fraud_flags(referral_id,type,detail) VALUES ($1,$2,$3::jsonb) RETURNING id", [referralId, type, JSON.stringify({ source: "verified_webhook" })]);
    await this.audit(tx, "FRAUD_FLAGGED", "fraud_flag", flag.rows[0].id);
  }
  private async audit(tx: SqlExecutor, action: string, subjectType: string, subjectId: string, actor?: OperationalAuditActor, beforeData: Record<string, unknown> | null = null, afterData: Record<string, unknown> | null = null) { await tx.query("INSERT INTO admin_audit_log (admin_user_id,action,subject_type,subject_id,request_id,before_data,after_data) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)", [actor?.adminUserId ?? null, action, subjectType, subjectId, actor?.requestId ?? null, beforeData ? JSON.stringify(beforeData) : null, afterData ? JSON.stringify(afterData) : null]); }
}
