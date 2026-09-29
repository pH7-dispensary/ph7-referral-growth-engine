export const referralStatuses = [
  "VISITED", "ATTRIBUTED", "REGISTERED", "BOOKED", "PAID", "QUALIFIED", "PAYABLE", "PAID_OUT",
  "CANCELLED", "REFUNDED", "REJECTED", "FRAUD_REVIEW", "EXPIRED",
] as const;

export type ReferralStatus = (typeof referralStatuses)[number];
export type LedgerEntryType = "CREDIT" | "PAYOUT" | "REVERSAL";
export type LedgerEntryStatus = "PENDING" | "EFFECTIVE" | "VOID";

export interface EconomicsSnapshot {
  readonly campaignId: string;
  readonly campaignVersion: number;
  readonly programmeSettingsVersion: number;
  readonly friendIncentiveMinor: number;
  readonly referrerRewardMinor: number;
  readonly currency: "EUR";
  readonly qualificationEvent: "consultation.paid";
  readonly holdingPeriodDays: number;
  readonly rewardCapMinor: number | null;
  readonly capturedAt: Date;
}

export interface Referral {
  readonly id: string;
  readonly referrerUserId: string;
  readonly attributionId: string;
  readonly economics: EconomicsSnapshot;
  status: ReferralStatus;
  statusBeforeFraudReview: ReferralStatus | null;
  readonly createdAt: Date;
  updatedAt: Date;
}

export interface ReferralEvent {
  readonly id: string;
  readonly referralId: string;
  readonly fromStatus: ReferralStatus | null;
  readonly toStatus: ReferralStatus;
  readonly source: "SYSTEM" | "MANUAL" | "WEBHOOK";
  readonly idempotencyKey: string;
  readonly occurredAt: Date;
}

export interface LedgerEntry {
  readonly id: string;
  readonly referralId: string | null;
  readonly payoutRequestId: string | null;
  readonly type: LedgerEntryType;
  readonly amountMinor: number;
  readonly currency: "EUR";
  readonly status: LedgerEntryStatus;
  readonly idempotencyKey: string;
  readonly effectiveAt: Date | null;
  readonly createdAt: Date;
}

export interface WebhookEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly receivedAt: Date;
  processedAt: Date | null;
}

export interface PayoutRequest {
  readonly id: string;
  readonly referralUserId: string;
  readonly amountMinor: number;
  readonly currency: "EUR";
  status: "REQUESTED" | "PAID" | "REJECTED" | "CANCELLED";
  readonly idempotencyKey: string;
  readonly createdAt: Date;
}
