import "server-only";

import type { ReferralRepository, TransactionRunner } from "@/lib/domain/repository";
import type { LedgerEntry, Referral, ReferralEvent, WebhookEvent } from "@/lib/domain/types";
import type { SqlExecutor } from "@/lib/persistence/postgres";

interface ReferralRow { id: string; referrer_user_id: string; attribution_id: string; status: Referral["status"]; status_before_fraud_review: Referral["status"] | null; campaign_id: string; campaign_version: number; programme_settings_version: number; friend_incentive_minor: number; referrer_reward_minor: number; currency: "EUR"; qualification_event: "consultation.paid"; holding_period_days: number; reward_cap_minor: number | null; created_at: Date | string; updated_at: Date | string; }
interface EventRow { id: string; referral_id: string; from_status: ReferralEvent["fromStatus"]; to_status: ReferralEvent["toStatus"]; source: ReferralEvent["source"]; idempotency_key: string; occurred_at: Date | string; }
interface LedgerRow { id: string; referral_id: string | null; payout_request_id: string | null; type: LedgerEntry["type"]; amount_minor: number; currency: "EUR"; status: LedgerEntry["status"]; idempotency_key: string; effective_at: Date | string | null; created_at: Date | string; }
interface WebhookRow { event_id: string; event_type: string; received_at: Date | string; processed_at: Date | string | null; }

const referralColumns = "id, referrer_user_id, attribution_id, status, status_before_fraud_review, campaign_id, campaign_version, programme_settings_version, friend_incentive_minor, referrer_reward_minor, currency, qualification_event, holding_period_days, reward_cap_minor, created_at, updated_at";
const ledgerColumns = "id, referral_id, payout_request_id, type, amount_minor, currency, status, idempotency_key, effective_at, created_at";
const date = (value: Date | string) => new Date(value);
function referral(row: ReferralRow): Referral { return { id: row.id, referrerUserId: row.referrer_user_id, attributionId: row.attribution_id, economics: Object.freeze({ campaignId: row.campaign_id, campaignVersion: row.campaign_version, programmeSettingsVersion: row.programme_settings_version, friendIncentiveMinor: row.friend_incentive_minor, referrerRewardMinor: row.referrer_reward_minor, currency: row.currency, qualificationEvent: row.qualification_event, holdingPeriodDays: row.holding_period_days, rewardCapMinor: row.reward_cap_minor, capturedAt: date(row.created_at) }), status: row.status, statusBeforeFraudReview: row.status_before_fraud_review, createdAt: date(row.created_at), updatedAt: date(row.updated_at) }; }
function event(row: EventRow): ReferralEvent { return { id: row.id, referralId: row.referral_id, fromStatus: row.from_status, toStatus: row.to_status, source: row.source, idempotencyKey: row.idempotency_key, occurredAt: date(row.occurred_at) }; }
function ledger(row: LedgerRow): LedgerEntry { return Object.freeze({ id: row.id, referralId: row.referral_id, payoutRequestId: row.payout_request_id, type: row.type, amountMinor: row.amount_minor, currency: row.currency, status: row.status, idempotencyKey: row.idempotency_key, effectiveAt: row.effective_at ? date(row.effective_at) : null, createdAt: date(row.created_at) }); }

export class PostgresDomainRepository implements ReferralRepository {
  constructor(private readonly sql: SqlExecutor) {}
  async findReferral(id: string) { const result = await this.sql.query<ReferralRow>(`SELECT ${referralColumns} FROM referrals WHERE id = $1 FOR UPDATE`, [id]); return result.rows[0] ? referral(result.rows[0]) : null; }
  async saveReferral(value: Referral) { await this.sql.query("UPDATE referrals SET status = $2, status_before_fraud_review = $3, updated_at = $4 WHERE id = $1", [value.id, value.status, value.statusBeforeFraudReview, value.updatedAt]); }
  async findReferralEventByKey(key: string) { const result = await this.sql.query<EventRow>("SELECT id, referral_id, from_status, to_status, source, idempotency_key, occurred_at FROM referral_events WHERE idempotency_key = $1", [key]); return result.rows[0] ? event(result.rows[0]) : null; }
  async appendReferralEvent(value: ReferralEvent) { await this.sql.query("INSERT INTO referral_events (id, referral_id, from_status, to_status, source, idempotency_key, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING", [value.id, value.referralId, value.fromStatus, value.toStatus, value.source, value.idempotencyKey, value.occurredAt]); }
  async findLedgerEntryByKey(key: string) { const result = await this.sql.query<LedgerRow>(`SELECT ${ledgerColumns} FROM reward_ledger WHERE idempotency_key = $1`, [key]); return result.rows[0] ? ledger(result.rows[0]) : null; }
  async appendLedgerEntry(value: LedgerEntry) {
    const user = value.referralId
      ? await this.sql.query<{ referrer_user_id: string }>("SELECT referrer_user_id FROM referrals WHERE id = $1", [value.referralId])
      : await this.sql.query<{ referral_user_id: string }>("SELECT referral_user_id FROM payout_requests WHERE id = $1", [value.payoutRequestId]);
    const userId = value.referralId ? (user.rows[0] as { referrer_user_id: string } | undefined)?.referrer_user_id : (user.rows[0] as { referral_user_id: string } | undefined)?.referral_user_id;
    if (!userId) throw new Error("A ledger entry requires a referral or payout owner.");
    await this.sql.query("INSERT INTO reward_ledger (id, referral_user_id, referral_id, payout_request_id, type, amount_minor, currency, status, idempotency_key, effective_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (idempotency_key) DO NOTHING", [value.id, userId, value.referralId, value.payoutRequestId, value.type, value.amountMinor, value.currency, value.status, value.idempotencyKey, value.effectiveAt, value.createdAt]);
  }
  async findWebhookEvent(eventId: string) { const result = await this.sql.query<WebhookRow>("SELECT event_id, event_type, received_at, processed_at FROM webhook_events WHERE event_id = $1", [eventId]); return result.rows[0] ? { eventId: result.rows[0].event_id, eventType: result.rows[0].event_type, receivedAt: date(result.rows[0].received_at), processedAt: result.rows[0].processed_at ? date(result.rows[0].processed_at) : null } : null; }
  async claimWebhookEvent(value: WebhookEvent) { const result = await this.sql.query<{ event_id: string }>("INSERT INTO webhook_events (event_id, event_type, payload_hash, received_at) VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING RETURNING event_id", [value.eventId, value.eventType, "domain-service-claimed", value.receivedAt]); return Boolean(result.rows[0]); }
  async markWebhookProcessed(eventId: string) { await this.sql.query("UPDATE webhook_events SET processed_at = now() WHERE event_id = $1", [eventId]); }
}

/** Production transaction runner for the already-existing domain services. */
export class PostgresTransactionRunner implements TransactionRunner {
  constructor(private readonly sql: SqlExecutor) {}
  async transaction<T>(operation: (repository: ReferralRepository) => Promise<T>): Promise<T> { return this.sql.transaction((transaction) => operation(new PostgresDomainRepository(transaction))); }
}
