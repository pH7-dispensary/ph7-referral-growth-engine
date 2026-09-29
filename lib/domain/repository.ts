import type { LedgerEntry, Referral, ReferralEvent, WebhookEvent } from "@/lib/domain/types";

export interface ReferralRepository {
  findReferral(id: string): Promise<Referral | null>;
  saveReferral(referral: Referral): Promise<void>;
  findReferralEventByKey(idempotencyKey: string): Promise<ReferralEvent | null>;
  appendReferralEvent(event: ReferralEvent): Promise<void>;
  findLedgerEntryByKey(idempotencyKey: string): Promise<LedgerEntry | null>;
  appendLedgerEntry(entry: LedgerEntry): Promise<void>;
  findWebhookEvent(eventId: string): Promise<WebhookEvent | null>;
  /** Returns false when another transaction has already claimed this external event. */
  claimWebhookEvent(event: WebhookEvent): Promise<boolean>;
  markWebhookProcessed(eventId: string): Promise<void>;
}

export interface TransactionRunner {
  transaction<T>(operation: (repository: ReferralRepository) => Promise<T>): Promise<T>;
}
