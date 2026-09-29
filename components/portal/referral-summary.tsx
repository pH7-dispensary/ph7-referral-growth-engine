import type { Referral } from "@/lib/domain/types";
import { formatEuro } from "@/lib/portal/format";
import { presentReferralStatus } from "@/lib/portal/status";

export function ReferralSummary({ referral, patientLabel }: { referral: Referral; patientLabel: string }) {
  const status = presentReferralStatus(referral.status);
  return (
    <li className="referral-row">
      <div>
        <p className="referral-name">{patientLabel}</p>
        <p className="referral-detail">{status.detail}</p>
      </div>
      <div className="referral-reward">
        <span className={`status-pill status-${status.tone}`}>{status.label}</span>
        <strong>{formatEuro(referral.economics.referrerRewardMinor)}</strong>
      </div>
    </li>
  );
}
