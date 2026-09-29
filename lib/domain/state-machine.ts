import { InvalidTransitionError } from "@/lib/domain/errors";
import type { ReferralStatus } from "@/lib/domain/types";

const transitions: Readonly<Record<ReferralStatus, readonly ReferralStatus[]>> = {
  VISITED: ["ATTRIBUTED", "CANCELLED", "EXPIRED"],
  ATTRIBUTED: ["REGISTERED", "FRAUD_REVIEW", "CANCELLED", "EXPIRED"],
  REGISTERED: ["BOOKED", "FRAUD_REVIEW", "CANCELLED", "EXPIRED"],
  BOOKED: ["PAID", "FRAUD_REVIEW", "CANCELLED", "EXPIRED"],
  PAID: ["QUALIFIED", "FRAUD_REVIEW", "REFUNDED"],
  QUALIFIED: ["PAYABLE", "FRAUD_REVIEW", "REFUNDED"],
  PAYABLE: ["PAID_OUT", "FRAUD_REVIEW", "REFUNDED"],
  PAID_OUT: [],
  CANCELLED: [],
  REFUNDED: [],
  REJECTED: [],
  FRAUD_REVIEW: ["ATTRIBUTED", "REGISTERED", "BOOKED", "PAID", "QUALIFIED", "PAYABLE", "REJECTED"],
  EXPIRED: [],
};

export function assertTransition(from: ReferralStatus, to: ReferralStatus): void {
  if (!transitions[from].includes(to)) throw new InvalidTransitionError(from, to);
}

export function canTransition(from: ReferralStatus, to: ReferralStatus): boolean {
  return transitions[from].includes(to);
}
