import { UniqueConstraintError } from "@/lib/domain/errors";
import type { ReferralRepository, TransactionRunner } from "@/lib/domain/repository";
import type { LedgerEntry, Referral, ReferralEvent, WebhookEvent } from "@/lib/domain/types";

/** Test double serializing transactions to model database unique-key guarantees. */
export class InMemoryReferralDatabase implements ReferralRepository, TransactionRunner {
  readonly referrals = new Map<string, Referral>();
  readonly events = new Map<string, ReferralEvent>();
  readonly ledger = new Map<string, LedgerEntry>();
  readonly webhooks = new Map<string, WebhookEvent>();
  private queue: Promise<void> = Promise.resolve();
  async transaction<T>(operation: (repository: ReferralRepository) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(this); } finally { release(); }
  }
  async findReferral(id: string) { return this.referrals.get(id) ?? null; }
  async saveReferral(referral: Referral) { this.referrals.set(referral.id, referral); }
  async findReferralEventByKey(key: string) { return this.events.get(key) ?? null; }
  async appendReferralEvent(event: ReferralEvent) { if (this.events.has(event.idempotencyKey)) throw new UniqueConstraintError(event.idempotencyKey); this.events.set(event.idempotencyKey, event); }
  async findLedgerEntryByKey(key: string) { return this.ledger.get(key) ?? null; }
  async appendLedgerEntry(entry: LedgerEntry) { if (this.ledger.has(entry.idempotencyKey)) throw new UniqueConstraintError(entry.idempotencyKey); this.ledger.set(entry.idempotencyKey, entry); }
  async findWebhookEvent(eventId: string) { return this.webhooks.get(eventId) ?? null; }
  async claimWebhookEvent(event: WebhookEvent) { if (this.webhooks.has(event.eventId)) return false; this.webhooks.set(event.eventId, event); return true; }
  async markWebhookProcessed(eventId: string) { const event = this.webhooks.get(eventId); if (!event) throw new Error("Webhook event must be claimed first."); this.webhooks.set(eventId, { ...event, processedAt: new Date() }); }
}
