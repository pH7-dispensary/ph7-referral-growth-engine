import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { captureEconomicsSnapshot } from "@/lib/domain/economics";
import { DomainError } from "@/lib/domain/errors";
import { assertTransition } from "@/lib/domain/state-machine";
import type { EconomicsSnapshot, LedgerEntry, Referral, ReferralStatus } from "@/lib/domain/types";

export type AdminSection = "overview" | "economics" | "campaigns" | "referrals" | "payouts" | "fraud" | "audit";
export type FraudType = "SELF_REFERRAL" | "DUPLICATE_REFERRED_USER" | "SAME_DEVICE" | "SUSPICIOUS_IP" | "HIGH_VELOCITY" | "REFUNDED_CONSULTATION" | "DUPLICATE_PAYMENT_EVENT" | "MANUAL_FLAG";
export interface LocalAudit { id: string; action: string; subjectId: string; createdAt: Date; }
export interface LocalPayout { id: string; referralUserId: string; amountMinor: number; status: "REQUESTED" | "PAID" | "REJECTED"; key: string; accountMask: string; createdAt: Date; paidAt: Date | null; }
export interface LocalFraud { id: string; referralId: string; type: FraudType; status: "OPEN" | "INVESTIGATING" | "APPROVED" | "REJECTED"; createdAt: Date; }
export interface LocalCampaign { id: string; version: number; active: boolean; friendIncentiveMinor: number; referrerRewardMinor: number; holdingPeriodDays: number; }
export interface LocalAnalyticsEvent { name: string; createdAt: Date; context: Record<string, string>; }

const webhookSchema = z.object({
  event_id: z.string().min(1).max(128), type: z.enum(["consultation.paid", "consultation.refunded"]),
  patient_reference: z.string().min(1).max(128), consultation_reference: z.string().min(1).max(128), attribution_id: z.string().min(1).max(128), timestamp: z.string().datetime(),
});
export type LocalWebhookPayload = z.infer<typeof webhookSchema>;

export class LocalReferralEngine {
  readonly referrals = new Map<string, Referral>();
  readonly ledger: LedgerEntry[] = [];
  readonly payouts = new Map<string, LocalPayout>();
  readonly fraud = new Map<string, LocalFraud>();
  readonly audits: LocalAudit[] = [];
  readonly webhookIds = new Set<string>();
  readonly analytics: LocalAnalyticsEvent[] = [];
  campaign: LocalCampaign = { id: "local-campaign", version: 1, active: true, friendIncentiveMinor: 1000, referrerRewardMinor: 1000, holdingPeriodDays: 14 };
  private queue: Promise<void> = Promise.resolve();
  private readonly transactionScope = new AsyncLocalStorage<boolean>();

  constructor() { this.seed(); }

  private seed() {
    const economics = this.snapshot();
    const paid: Referral = { id: "local-ref-paid", referrerUserId: "synthetic-ava", attributionId: "attr_local_paid", economics, status: "PAID", statusBeforeFraudReview: null, createdAt: new Date(), updatedAt: new Date() };
    const payable: Referral = { id: "local-ref-payable", referrerUserId: "synthetic-ava", attributionId: "attr_local_payable", economics, status: "PAYABLE", statusBeforeFraudReview: null, createdAt: new Date(), updatedAt: new Date() };
    this.referrals.set(paid.id, paid); this.referrals.set(payable.id, payable);
    this.post("CREDIT", 1000, payable.id, "seed-credit");
  }

  async transaction<T>(work: () => Promise<T> | T): Promise<T> { if (this.transactionScope.getStore()) return work(); const previous = this.queue; let release!: () => void; this.queue = new Promise((resolve) => { release = resolve; }); await previous; try { return await this.transactionScope.run(true, work); } finally { release(); } }
  private audit(action: string, subjectId: string) { this.audits.unshift({ id: randomUUID(), action, subjectId, createdAt: new Date() }); }
  private snapshot(): EconomicsSnapshot { return captureEconomicsSnapshot({ campaignId: this.campaign.id, campaignVersion: this.campaign.version, programmeSettingsVersion: this.campaign.version, friendIncentiveMinor: this.campaign.friendIncentiveMinor, referrerRewardMinor: this.campaign.referrerRewardMinor, currency: "EUR", qualificationEvent: "consultation.paid", holdingPeriodDays: this.campaign.holdingPeriodDays, rewardCapMinor: null }); }
  private post(type: LedgerEntry["type"], amountMinor: number, referralId: string | null, key: string, payoutRequestId: string | null = null): LedgerEntry {
    const existing = this.ledger.find((entry) => entry.idempotencyKey === key); if (existing) return existing;
    const entry: LedgerEntry = Object.freeze({ id: randomUUID(), referralId, payoutRequestId, type, amountMinor, currency: "EUR", status: "EFFECTIVE", idempotencyKey: key, effectiveAt: new Date(), createdAt: new Date() }); this.ledger.push(entry); return entry;
  }
  balance(userId = "synthetic-ava") { const ids = new Set([...this.referrals.values()].filter((referral) => referral.referrerUserId === userId).map((referral) => referral.id)); return this.ledger.filter((entry) => (entry.referralId === null || ids.has(entry.referralId)) && entry.status === "EFFECTIVE").reduce((total, entry) => total + entry.amountMinor, 0); }
  lifetime(userId = "synthetic-ava") { const ids = new Set([...this.referrals.values()].filter((referral) => referral.referrerUserId === userId).map((referral) => referral.id)); return this.ledger.filter((entry) => entry.type === "CREDIT" && entry.referralId && ids.has(entry.referralId)).reduce((total, entry) => total + entry.amountMinor, 0); }

  async setEconomics(input: { friendIncentiveMinor: number; referrerRewardMinor: number; active: boolean }) { return this.transaction(() => { if (!Number.isInteger(input.friendIncentiveMinor) || !Number.isInteger(input.referrerRewardMinor) || input.friendIncentiveMinor < 0 || input.referrerRewardMinor < 0) throw new DomainError("Invalid programme economics.", "INVALID_ECONOMICS"); this.campaign = { ...this.campaign, version: this.campaign.version + 1, ...input }; this.audit("PROGRAMME_UPDATED", this.campaign.id); return this.campaign; }); }
  createReferral(attributionId: string, userId = "synthetic-ava") { const referral: Referral = { id: randomUUID(), referrerUserId: userId, attributionId, economics: this.snapshot(), status: "ATTRIBUTED", statusBeforeFraudReview: null, createdAt: new Date(), updatedAt: new Date() }; this.referrals.set(referral.id, referral); return referral; }
  async transition(referralId: string, to: ReferralStatus) { return this.transaction(() => { const referral = this.requireReferral(referralId); assertTransition(referral.status, to); if (to === "FRAUD_REVIEW") referral.statusBeforeFraudReview = referral.status; referral.status = to; referral.updatedAt = new Date(); this.audit(`REFERRAL_${to}`, referral.id); return referral; }); }
  async qualify(referralId: string, key: string, source: "MANUAL" | "WEBHOOK") { return this.transaction(() => { const referral = this.requireReferral(referralId); if ([...this.fraud.values()].some((flag) => flag.referralId === referralId && flag.status !== "APPROVED")) { if (referral.status !== "FRAUD_REVIEW") { referral.statusBeforeFraudReview = referral.status; referral.status = "FRAUD_REVIEW"; } throw new DomainError("Referral requires fraud review.", "FRAUD_REVIEW"); }
    const existing = this.ledger.find((entry) => entry.idempotencyKey === `credit:${key}`); if (existing) return referral;
    assertTransition(referral.status, "QUALIFIED"); referral.status = "QUALIFIED"; referral.updatedAt = new Date(); this.post("CREDIT", referral.economics.referrerRewardMinor, referral.id, `credit:${key}`); this.audit(`QUALIFIED_${source}`, referral.id); return referral; }); }
  async refund(referralId: string, key: string) { return this.transaction(() => { const referral = this.requireReferral(referralId); const existing = this.ledger.find((entry) => entry.idempotencyKey === `reversal:${key}`); if (existing) return referral; if (!["PAID", "QUALIFIED", "PAYABLE"].includes(referral.status)) throw new DomainError("Referral cannot be refunded from this state.", "INVALID_REFUND"); referral.status = "REFUNDED"; const credit = this.ledger.find((entry) => entry.referralId === referralId && entry.type === "CREDIT" && entry.status === "EFFECTIVE"); if (credit) this.post("REVERSAL", -credit.amountMinor, referral.id, `reversal:${key}`); this.audit("REFUNDED", referral.id); return referral; }); }
  async requestPayout(userId: string, amountMinor: number, key: string, accountMask = "•••• 0154") { return this.transaction(() => { const existing = [...this.payouts.values()].find((payout) => payout.key === key); if (existing) return existing; if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > this.balance(userId)) throw new DomainError("Payout amount is unavailable.", "INVALID_PAYOUT"); const payout: LocalPayout = { id: randomUUID(), referralUserId: userId, amountMinor, status: "REQUESTED", key, accountMask, createdAt: new Date(), paidAt: null }; this.payouts.set(payout.id, payout); this.audit("PAYOUT_REQUESTED", payout.id); return payout; }); }
  async markPayoutPaid(payoutId: string, key: string) { return this.transaction(() => { const payout = this.payouts.get(payoutId); if (!payout) throw new DomainError("Payout does not exist.", "PAYOUT_NOT_FOUND"); if (payout.status === "PAID") return payout; this.post("PAYOUT", -payout.amountMinor, null, `payout:${key}`, payout.id); payout.status = "PAID"; payout.paidAt = new Date(); this.audit("PAYOUT_PAID", payout.id); return payout; }); }
  async flag(referralId: string, type: FraudType) { return this.transaction(() => { const referral = this.requireReferral(referralId); const existing = [...this.fraud.values()].find((flag) => flag.referralId === referralId && flag.type === type && flag.status !== "REJECTED"); if (existing) return existing; const flag: LocalFraud = { id: randomUUID(), referralId, type, status: "OPEN", createdAt: new Date() }; this.fraud.set(flag.id, flag); referral.statusBeforeFraudReview = referral.status; referral.status = "FRAUD_REVIEW"; this.audit("FRAUD_FLAGGED", flag.id); return flag; }); }
  async resolveFraud(flagId: string, decision: "APPROVED" | "REJECTED" | "INVESTIGATING") { return this.transaction(() => { const flag = this.fraud.get(flagId); if (!flag) throw new DomainError("Fraud flag does not exist.", "FRAUD_NOT_FOUND"); flag.status = decision; const referral = this.requireReferral(flag.referralId); if (decision === "APPROVED" && referral.status === "FRAUD_REVIEW") referral.status = referral.statusBeforeFraudReview ?? "PAID"; if (decision === "REJECTED") referral.status = "REJECTED"; this.audit(`FRAUD_${decision}`, flag.id); return flag; }); }
  recordAnalytics(name: string, context: Record<string, string> = {}) { this.analytics.push({ name, context, createdAt: new Date() }); }
  metrics() { const referrals = [...this.referrals.values()]; return { activeReferrers: new Set(referrals.map((referral) => referral.referrerUserId)).size, rewardSpendMinor: this.ledger.filter((entry) => entry.type === "CREDIT").reduce((sum, entry) => sum + entry.amountMinor, 0), outstandingLiabilityMinor: Math.max(0, this.balance()), referralCount: referrals.length, qualifiedCount: referrals.filter((referral) => ["QUALIFIED", "PAYABLE", "PAID_OUT"].includes(referral.status)).length }; }
  private requireReferral(id: string) { const referral = this.referrals.get(id); if (!referral) throw new DomainError("Referral does not exist.", "REFERRAL_NOT_FOUND"); return referral; }
  verifySignature(body: string, signature: string, secret: string) { const expected = createHmac("sha256", secret).update(body).digest("hex"); const received = Buffer.from(signature, "hex"); const actual = Buffer.from(expected, "hex"); return received.length === actual.length && timingSafeEqual(received, actual); }
  async processWebhook(body: string, signature: string, secret: string) { if (!this.verifySignature(body, signature, secret)) throw new DomainError("Invalid webhook signature.", "INVALID_SIGNATURE"); const payload = webhookSchema.parse(JSON.parse(body)); return this.transaction(async () => { if (this.webhookIds.has(payload.event_id)) return { duplicate: true, payload }; this.webhookIds.add(payload.event_id); const referral = [...this.referrals.values()].find((item) => item.attributionId === payload.attribution_id) ?? this.createReferral(payload.attribution_id); try { if (payload.type === "consultation.paid") { while (referral.status !== "PAID") { const next: Record<ReferralStatus, ReferralStatus | undefined> = { VISITED: "ATTRIBUTED", ATTRIBUTED: "REGISTERED", REGISTERED: "BOOKED", BOOKED: "PAID", PAID: undefined, QUALIFIED: undefined, PAYABLE: undefined, PAID_OUT: undefined, CANCELLED: undefined, REFUNDED: undefined, REJECTED: undefined, FRAUD_REVIEW: undefined, EXPIRED: undefined }; const target = next[referral.status]; if (!target) break; await this.transition(referral.id, target); } await this.qualify(referral.id, payload.event_id, "WEBHOOK"); } else await this.refund(referral.id, payload.event_id); this.audit("WEBHOOK_PROCESSED", payload.event_id); return { duplicate: false, payload }; } catch (error) { this.webhookIds.delete(payload.event_id); throw error; } }); }
}

const engineKey = "__ph7LocalReferralEngine" as const; type GlobalEngine = typeof globalThis & { [engineKey]?: LocalReferralEngine };
export function getLocalReferralEngine() { const globalStore = globalThis as GlobalEngine; globalStore[engineKey] ??= new LocalReferralEngine(); return globalStore[engineKey]; }
export function localWebhookSecret() { return process.env.PH7_LOCAL_WEBHOOK_SECRET ?? "local-only-webhook-secret"; }
