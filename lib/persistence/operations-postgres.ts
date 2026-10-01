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

export class PostgresOperationalRepository {
  constructor(private readonly sql: SqlExecutor) {}
  async activeCampaign(): Promise<RuntimeCampaign | null> { const r = await this.sql.query<{ id: string; version: number; is_active: boolean; friend_incentive_minor: number; referrer_reward_minor: number; holding_period_days: number }>("SELECT id, version, is_active, friend_incentive_minor, referrer_reward_minor, holding_period_days FROM campaigns WHERE is_active LIMIT 1"); const row = r.rows[0]; return row ? { id: row.id, version: row.version, active: row.is_active, friendIncentiveMinor: row.friend_incentive_minor, referrerRewardMinor: row.referrer_reward_minor, holdingPeriodDays: row.holding_period_days } : null; }
  async setCampaign(input: { friendIncentiveMinor: number; referrerRewardMinor: number; active: boolean; holdingPeriodDays?: number }, actor?: OperationalAuditActor): Promise<RuntimeCampaign> {
    if (!Number.isSafeInteger(input.friendIncentiveMinor) || !Number.isSafeInteger(input.referrerRewardMinor) || input.friendIncentiveMinor < 0 || input.referrerRewardMinor < 0) throw new Error("Invalid campaign economics.");
    return this.sql.transaction(async (tx) => { await tx.query("LOCK TABLE campaigns IN SHARE ROW EXCLUSIVE MODE"); const old = await tx.query<{ version: number; holding_period_days: number }>("SELECT version, holding_period_days FROM campaigns WHERE is_active FOR UPDATE"); const version = (old.rows[0]?.version ?? 0) + 1; const holding = input.holdingPeriodDays ?? old.rows[0]?.holding_period_days ?? 0; await tx.query("UPDATE campaigns SET is_active = false WHERE is_active"); const created = await tx.query<{ id: string }>("INSERT INTO campaigns (version, name, is_active, friend_incentive_minor, referrer_reward_minor, holding_period_days) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [version, `Referral programme v${version}`, input.active, input.friendIncentiveMinor, input.referrerRewardMinor, holding]); await tx.query("INSERT INTO programme_settings (version, programme_enabled) VALUES ((SELECT COALESCE(MAX(version),0)+1 FROM programme_settings), $1)", [input.active]); await this.audit(tx, "PROGRAMME_UPDATED", "campaign", created.rows[0].id, actor); return { id: created.rows[0].id, version, active: input.active, friendIncentiveMinor: input.friendIncentiveMinor, referrerRewardMinor: input.referrerRewardMinor, holdingPeriodDays: holding }; });
  }
  async requestPayout(input: { referralUserId: string; payoutAccountId: string; amountMinor: number; idempotencyKey: string }, actor?: OperationalAuditActor) { return this.sql.transaction(async (tx) => { await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.referralUserId]); const existing = await tx.query<{ id: string; status: string }>("SELECT id, status FROM payout_requests WHERE idempotency_key = $1", [input.idempotencyKey]); if (existing.rows[0]) return existing.rows[0]; const account = await tx.query("SELECT id FROM payout_accounts WHERE id = $1 AND referral_user_id = $2", [input.payoutAccountId, input.referralUserId]); if (!account.rows[0]) throw new Error("Payout account is unavailable."); const balance = await tx.query<{ balance: string }>("SELECT COALESCE(SUM(amount_minor),0)::text AS balance FROM reward_ledger WHERE referral_user_id = $1 AND status = 'EFFECTIVE'", [input.referralUserId]); if (input.amountMinor <= 0 || input.amountMinor > Number(balance.rows[0].balance)) throw new Error("Payout amount is unavailable."); const payout = await tx.query<{ id: string; status: string }>("INSERT INTO payout_requests (referral_user_id, payout_account_id, amount_minor, idempotency_key) VALUES ($1,$2,$3,$4) RETURNING id,status", [input.referralUserId, input.payoutAccountId, input.amountMinor, input.idempotencyKey]); await this.audit(tx, "PAYOUT_REQUESTED", "payout_request", payout.rows[0].id, actor); return payout.rows[0]; }); }
  async markPayoutPaid(payoutId: string, idempotencyKey: string, actor?: OperationalAuditActor) { return this.sql.transaction(async (tx) => { const payout = await tx.query<{ referral_user_id: string; amount_minor: number; status: string }>("SELECT referral_user_id, amount_minor, status FROM payout_requests WHERE id = $1 FOR UPDATE", [payoutId]); const row = payout.rows[0]; if (!row) throw new Error("Payout does not exist."); if (row.status === "PAID") return { id: payoutId, status: row.status }; await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [row.referral_user_id]); const balance = await tx.query<{ balance: string }>("SELECT COALESCE(SUM(amount_minor),0)::text AS balance FROM reward_ledger WHERE referral_user_id = $1 AND status = 'EFFECTIVE'", [row.referral_user_id]); if (row.amount_minor > Number(balance.rows[0].balance)) throw new Error("Payout balance is unavailable."); await tx.query("UPDATE payout_requests SET status = 'PAID', paid_at = now() WHERE id = $1", [payoutId]); await tx.query("INSERT INTO reward_ledger (referral_user_id, payout_request_id, type, amount_minor, idempotency_key) VALUES ($1,$2,'PAYOUT',$3,$4) ON CONFLICT DO NOTHING", [row.referral_user_id, payoutId, -row.amount_minor, idempotencyKey]); await this.audit(tx, "PAYOUT_PAID", "payout_request", payoutId, actor); return { id: payoutId, status: "PAID" }; }); }
  async flagFraud(referralId: string, type: FraudType, actor?: OperationalAuditActor) { return this.sql.transaction(async (tx) => { const referral = new PostgresDomainRepository(tx); const current = await referral.findReferral(referralId); if (!current) throw new Error("Referral does not exist."); const existing = await tx.query<{ id: string; status: string }>("SELECT id,status FROM fraud_flags WHERE referral_id = $1 AND type = $2 AND status <> 'REJECTED' FOR UPDATE", [referralId, type]); if (existing.rows[0]) return existing.rows[0]; const lifecycle = new ReferralLifecycleService({ transaction: async (work) => work(referral) }); await lifecycle.transitionInTransaction(referral, { referralId, toStatus: "FRAUD_REVIEW", source: "SYSTEM", idempotencyKey: `fraud:${referralId}:${type}` }); const flag = await tx.query<{ id: string; status: string }>("INSERT INTO fraud_flags (referral_id,type) VALUES ($1,$2) RETURNING id,status", [referralId, type]); await this.audit(tx, "FRAUD_FLAGGED", "fraud_flag", flag.rows[0].id, actor); return flag.rows[0]; }); }
  async resolveFraud(flagId: string, decision: FraudDecision, actor?: OperationalAuditActor) { return this.sql.transaction(async (tx) => { const flag = await tx.query<{ referral_id: string }>("SELECT referral_id FROM fraud_flags WHERE id = $1 FOR UPDATE", [flagId]); if (!flag.rows[0]) throw new Error("Fraud flag does not exist."); const repo = new PostgresDomainRepository(tx); const value = await repo.findReferral(flag.rows[0].referral_id); if (!value) throw new Error("Referral does not exist."); const target: ReferralStatus | null = decision === "APPROVED" ? value.statusBeforeFraudReview : decision === "REJECTED" ? "REJECTED" : null; if (target && value.status === "FRAUD_REVIEW") { const lifecycle = new ReferralLifecycleService({ transaction: async (work) => work(repo) }); await lifecycle.transitionInTransaction(repo, { referralId: value.id, toStatus: target, source: "MANUAL", idempotencyKey: `fraud-resolution:${flagId}:${decision}` }); } await tx.query("UPDATE fraud_flags SET status = $2, resolved_at = CASE WHEN $2 IN ('APPROVED','REJECTED') THEN now() ELSE NULL END WHERE id = $1", [flagId, decision]); await this.audit(tx, `FRAUD_${decision}`, "fraud_flag", flagId, actor); return { id: flagId, status: decision }; }); }
  async processWebhook(input: { eventId: string; eventType: "consultation.paid" | "consultation.refunded"; attributionPublicId: string; payloadHash?: string }) {
    return this.sql.transaction(async (tx) => {
      const claimed = await tx.query<{ event_id: string }>(
        "INSERT INTO webhook_events (event_id,event_type,payload_hash) VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
        [input.eventId, input.eventType, input.payloadHash ?? "verified-webhook"],
      );
      if (!claimed.rows[0]) return { duplicate: true, unknownAttribution: false };
      const source = await tx.query<{ attribution_id: string; referrer_user_id: string; campaign_id: string; campaign_version: number; programme_settings_version: number; friend_incentive_minor: number; referrer_reward_minor: number; currency: "EUR"; qualification_event: "consultation.paid"; holding_period_days: number; reward_cap_minor: number | null }>(
        "SELECT a.id AS attribution_id, rc.referral_user_id AS referrer_user_id, a.campaign_id, a.campaign_version, a.programme_settings_version, a.friend_incentive_minor, a.referrer_reward_minor, a.currency, a.qualification_event, a.holding_period_days, a.reward_cap_minor FROM referral_attributions a JOIN referral_codes rc ON rc.id=a.referral_code_id WHERE a.public_id=$1",
        [input.attributionPublicId],
      );
      const row = source.rows[0];
      if (!row) {
        await tx.query("UPDATE webhook_events SET processed_at=now() WHERE event_id=$1", [input.eventId]);
        return { duplicate: false, unknownAttribution: true };
      }
      await tx.query(
        "INSERT INTO referrals (referrer_user_id,attribution_id,campaign_id,campaign_version,programme_settings_version,friend_incentive_minor,referrer_reward_minor,currency,qualification_event,holding_period_days,reward_cap_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (attribution_id) DO NOTHING",
        [row.referrer_user_id,row.attribution_id,row.campaign_id,row.campaign_version,row.programme_settings_version,row.friend_incentive_minor,row.referrer_reward_minor,row.currency,row.qualification_event,row.holding_period_days,row.reward_cap_minor],
      );
      const referralId = (await tx.query<{ id: string }>("SELECT id FROM referrals WHERE attribution_id=$1", [row.attribution_id])).rows[0]!.id;
      const repo = new PostgresDomainRepository(tx);
      const lifecycle = new ReferralLifecycleService({ transaction: async (work) => work(repo) });
      const ledger = new LedgerService({ transaction: async (work) => work(repo) });
      const current = await repo.findReferral(referralId);
      if (!current) throw new Error("Referral is unavailable.");
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
  private async audit(tx: SqlExecutor, action: string, subjectType: string, subjectId: string, actor?: OperationalAuditActor) { await tx.query("INSERT INTO admin_audit_log (admin_user_id,action,subject_type,subject_id,request_id) VALUES ($1,$2,$3,$4,$5)", [actor?.adminUserId ?? null, action, subjectType, subjectId, actor?.requestId ?? null]); }
}
