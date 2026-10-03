import { captureEconomicsSnapshot } from "@/lib/domain/economics";
import type { LedgerEntry, Referral } from "@/lib/domain/types";
import { formatEuro } from "@/lib/portal/format";
import { sumMinorUnits, toMinorUnits } from "@/lib/portal/money";
import { buildReferralUrl } from "@/lib/portal/referral-link";
import { presentReferralStatus } from "@/lib/portal/status";

export interface PortalPayoutHistoryItem {
  id: string;
  amountMinor: number;
  status: "REQUESTED" | "PAID" | "REJECTED" | "CANCELLED";
  requestedAt: Date;
  paidAt: Date | null;
  accountMask: string;
}

export interface PatientPortalData {
  syntheticPatientName: string;
  displayName: string;
  environmentLabel?: string;
  referralCode: string;
  referralUrl: string;
  friendIncentiveMinor: number;
  currentRewardMinor: number;
  holdingPeriodDays: number;
  availableBalanceMinor: number;
  pendingBalanceMinor: number;
  totalEarnedMinor: number;
  minimumWithdrawalMinor: number;
  referrals: Array<Referral & { patientLabel: string }>;
  payouts: PortalPayoutHistoryItem[];
}

function snapshot(rewardMinor: number, campaignVersion: number) {
  return captureEconomicsSnapshot({
    campaignId: "synthetic-campaign", campaignVersion, programmeSettingsVersion: campaignVersion,
    friendIncentiveMinor: 1000, referrerRewardMinor: rewardMinor, currency: "EUR",
    qualificationEvent: "consultation.paid", holdingPeriodDays: 14, rewardCapMinor: null,
  });
}

const now = new Date("2026-09-23T10:00:00.000Z");
const syntheticReferrals: Array<Referral & { patientLabel: string }> = [
  { id: "synthetic-ref-1", referrerUserId: "synthetic-ava", attributionId: "synthetic-attr-1", economics: snapshot(1000, 1), status: "PAYABLE", statusBeforeFraudReview: null, patientLabel: "Friend 1", createdAt: now, updatedAt: now },
  { id: "synthetic-ref-2", referrerUserId: "synthetic-ava", attributionId: "synthetic-attr-2", economics: snapshot(1000, 1), status: "QUALIFIED", statusBeforeFraudReview: null, patientLabel: "Friend 2", createdAt: now, updatedAt: now },
  { id: "synthetic-ref-3", referrerUserId: "synthetic-ava", attributionId: "synthetic-attr-3", economics: snapshot(1500, 2), status: "PAID", statusBeforeFraudReview: null, patientLabel: "Friend 3", createdAt: now, updatedAt: now },
];
const syntheticLedger: LedgerEntry[] = [
  { id: "ledger-1", referralId: "synthetic-ref-1", payoutRequestId: null, type: "CREDIT", amountMinor: 1000, currency: "EUR", status: "EFFECTIVE", idempotencyKey: "synthetic-credit-1", effectiveAt: now, createdAt: now },
  { id: "ledger-2", referralId: "synthetic-ref-2", payoutRequestId: null, type: "CREDIT", amountMinor: 1000, currency: "EUR", status: "PENDING", idempotencyKey: "synthetic-credit-2", effectiveAt: null, createdAt: now },
  { id: "ledger-3", referralId: null, payoutRequestId: "synthetic-paid-payout", type: "PAYOUT", amountMinor: -1000, currency: "EUR", status: "EFFECTIVE", idempotencyKey: "synthetic-payout-1", effectiveAt: now, createdAt: now },
  { id: "ledger-4", referralId: null, payoutRequestId: null, type: "CREDIT", amountMinor: 2000, currency: "EUR", status: "EFFECTIVE", idempotencyKey: "synthetic-credit-historical", effectiveAt: now, createdAt: now },
];

export function buildPatientPortalData(referrals: PatientPortalData["referrals"], ledger: LedgerEntry[]): Pick<PatientPortalData, "currentRewardMinor" | "availableBalanceMinor" | "pendingBalanceMinor" | "totalEarnedMinor" | "referrals"> {
  const effective = sumMinorUnits(ledger.filter((entry) => entry.status === "EFFECTIVE").map((entry) => entry.amountMinor), "effective ledger amount");
  const pending = sumMinorUnits(ledger.filter((entry) => entry.status === "PENDING" && entry.type === "CREDIT").map((entry) => entry.amountMinor), "pending ledger amount");
  const earned = sumMinorUnits(ledger.filter((entry) => entry.type === "CREDIT" && entry.status !== "VOID").map((entry) => entry.amountMinor), "earned ledger amount");
  return {
    currentRewardMinor: toMinorUnits(referrals[0]?.economics.referrerRewardMinor ?? 0, "current reward"),
    availableBalanceMinor: effective,
    pendingBalanceMinor: pending,
    totalEarnedMinor: earned,
    referrals,
  };
}

export function getSyntheticPatientPortalData(): PatientPortalData {
  const referralCode = "PH7-AVA-72";
  const totals = buildPatientPortalData(syntheticReferrals, syntheticLedger);
  return {
    ...totals,
    syntheticPatientName: "Ava (test patient)",
    displayName: "Ava",
    environmentLabel: "Development preview",
    referralCode,
    referralUrl: buildReferralUrl(referralCode),
    friendIncentiveMinor: 1000,
    holdingPeriodDays: 14,
    minimumWithdrawalMinor: 1000,
    payouts: [{ id: "synthetic-paid-payout", amountMinor: 1000, status: "PAID", requestedAt: now, paidAt: now, accountMask: "•••• 0154" }],
  };
}

export function describeReward(minor: number): string {
  return `${formatEuro(minor)} per friend who qualifies`;
}

export { presentReferralStatus };
