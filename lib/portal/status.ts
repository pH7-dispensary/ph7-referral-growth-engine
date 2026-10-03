import type { ReferralStatus } from "@/lib/domain/types";

export interface PatientStatus {
  label: string;
  detail: string;
  tone: "neutral" | "positive" | "pending" | "review" | "muted";
}

const patientStatuses: Record<ReferralStatus, PatientStatus> = {
  VISITED: { label: "Link opened", detail: "Your friend has opened your invitation.", tone: "neutral" },
  ATTRIBUTED: { label: "Invitation tracked", detail: "Their visit is linked to your invitation.", tone: "neutral" },
  REGISTERED: { label: "Friend joined", detail: "Waiting for first consultation.", tone: "positive" },
  BOOKED: { label: "Consultation booked", detail: "Reward pending.", tone: "pending" },
  PAID: { label: "Consultation completed", detail: "We are checking the referral details.", tone: "pending" },
  QUALIFIED: { label: "Reward pending", detail: "Your reward is in its holding period.", tone: "pending" },
  PAYABLE: { label: "Reward ready", detail: "Your reward is available to request.", tone: "positive" },
  PAID_OUT: { label: "Paid out", detail: "Your reward has been sent to your selected account.", tone: "positive" },
  CANCELLED: { label: "Cancelled/refunded", detail: "This referral did not continue.", tone: "muted" },
  REFUNDED: { label: "Cancelled/refunded", detail: "The consultation was refunded, so this reward was reversed.", tone: "muted" },
  REJECTED: { label: "Not eligible", detail: "This referral was not eligible for a reward.", tone: "muted" },
  FRAUD_REVIEW: { label: "Under review", detail: "We are reviewing this referral before confirming a reward.", tone: "review" },
  EXPIRED: { label: "Invitation expired", detail: "This referral was not completed in time.", tone: "muted" },
};

export function presentReferralStatus(status: ReferralStatus): PatientStatus {
  return patientStatuses[status];
}
