import type { FunnelUnavailableReason } from "@/lib/funnel/attribution";

export function unavailableOfferCopy(reason: FunnelUnavailableReason): { title: string; description: string } {
  switch (reason) {
    case "MALFORMED_CODE": return { title: "This invitation link doesn’t look right", description: "Please check the link and try again." };
    case "INVALID_CODE": return { title: "This invitation isn’t available", description: "It may have been copied incorrectly or is no longer in use." };
    case "INACTIVE_CODE": return { title: "This invitation is no longer active", description: "Ask your friend for a new invitation if they have one." };
    case "EXPIRED_CAMPAIGN": return { title: "This offer has ended", description: "Referral offers can change over time. Please ask your friend for a current invitation." };
    case "INACTIVE_OFFER": return { title: "This offer is currently unavailable", description: "Please try again later or ask your friend for a new invitation." };
    case "UNAVAILABLE": return { title: "This offer is unavailable", description: "Please try again later." };
  }
}
