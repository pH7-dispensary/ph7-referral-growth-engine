import type { PatientPortalData } from "@/lib/portal/data";
import { formatEuro } from "@/lib/portal/format";
import { presentReferralStatus } from "@/lib/portal/status";

export function ReferralSummary({ referral, patientLabel }: { referral: PatientPortalData["referrals"][number]; patientLabel: string }) {
  const status = presentReferralStatus(referral.status);
  const credit = referral.ledgerCredit;
  const amount = formatEuro(credit?.amountMinor ?? referral.economics.referrerRewardMinor);
  const reward = referral.hasLedgerReversal ? "Reward reversed"
    : referral.status === "PAID_OUT" ? `${amount} paid`
    : referral.status === "FRAUD_REVIEW" ? `${amount} under review`
    : ["CANCELLED", "REFUNDED", "REJECTED", "EXPIRED"].includes(referral.status) || credit?.status === "VOID" ? "No reward payable"
    : referral.status === "PAYABLE" && credit?.status === "EFFECTIVE" ? `${amount} cash available`
    : credit?.status === "PENDING" ? `${amount} cash pending`
    : credit?.status === "EFFECTIVE" ? `${amount} awaiting release`
    : `${amount} potential reward`;
  return (
    <li className="referral-row">
      <div>
        <p className="referral-name">{patientLabel}</p>
        <p className="referral-detail">{status.detail}</p>
      </div>
      <div className="referral-reward">
        <span className={`status-pill status-${status.tone}`}>{status.label}</span>
        <strong>{reward}</strong>
      </div>
    </li>
  );
}
