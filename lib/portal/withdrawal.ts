import { formatEuro } from "@/lib/portal/format";

/** Presentation eligibility only. The existing payout service authorises requests. */
export function withdrawalPresentation(availableMinor: number, minimumMinor: number, hasAction: boolean, underReview = false) {
  const canRequest = !underReview && hasAction && minimumMinor > 0 && availableMinor >= minimumMinor;
  const reason = underReview ? "Withdrawals are under review. Your cash remains recorded."
    : availableMinor <= 0
    ? "Your rewards will appear here when they become available."
    : minimumMinor > 0 && availableMinor < minimumMinor
      ? `Withdrawals start at ${formatEuro(minimumMinor)}.`
      : !hasAction
        ? "Online withdrawals are not available yet."
        : minimumMinor <= 0
          ? "Withdrawals are currently unavailable."
          : "Requests are reviewed by pH7 before payment.";
  return { canRequest, reason };
}
