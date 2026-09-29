import { PayoutForm } from "@/components/portal/payout-form";
import type { PayoutActionState } from "@/lib/portal/actions";
import { ReferralSummary } from "@/components/portal/referral-summary";
import { ShareActions } from "@/components/portal/share-actions";
import type { PatientPortalData } from "@/lib/portal/data";
import { describeReward } from "@/lib/portal/data";
import { formatEuro } from "@/lib/portal/format";
import Link from "next/link";

export function PortalDashboard({
  data,
  qrSvg,
  payoutAction,
  payoutNote,
}: {
  data: PatientPortalData;
  qrSvg: string;
  payoutAction?: (previousState: PayoutActionState, formData: FormData) => Promise<PayoutActionState>;
  payoutNote?: string;
}) {
  return (
    <main className="portal-shell">
      <header className="portal-header">
        <Link className="brand" href="/portal" aria-label="pH7 Referral Portal">pH<span>7</span></Link>
        <span className="test-badge">Staging synthetic patient</span>
      </header>

      <section className="portal-hero" aria-labelledby="welcome-title">
        <p className="eyebrow">Your referral space</p>
        <h1 id="welcome-title">Invite someone. Share the care.</h1>
        <p>Hi {data.syntheticPatientName}. When a friend completes their qualifying consultation, your reward becomes available after the holding period.</p>
      </section>

      <section className="offer-card" aria-label="Current referral reward">
        <div>
          <p className="eyebrow">Current reward</p>
          <strong>{describeReward(data.currentRewardMinor)}</strong>
          <p>Your friend receives a welcome incentive too.</p>
        </div>
        <div className="offer-orb" aria-hidden="true">+</div>
      </section>

      <section className="share-card" aria-labelledby="share-title">
        <div className="section-heading">
          <div><p className="eyebrow">Your invitation</p><h2 id="share-title">Make sharing simple</h2></div>
          <span className="code-chip">{data.referralCode}</span>
        </div>
        <p className="referral-link">{data.referralUrl}</p>
        <ShareActions referralUrl={data.referralUrl} />
        <div className="qr-area">
          <div aria-label="QR code for your referral link" className="qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p><strong>In person?</strong><br />Let your friend scan this code to open your invitation.</p>
        </div>
      </section>

      <section aria-labelledby="balance-title">
        <div className="section-heading"><div><p className="eyebrow">Your rewards</p><h2 id="balance-title">A clear view of your balance</h2></div></div>
        <div className="balance-grid">
          <article className="balance-card balance-available"><span>Available</span><strong>{formatEuro(data.availableBalanceMinor)}</strong><p>Ready to withdraw</p></article>
          <article className="balance-card"><span>Pending</span><strong>{formatEuro(data.pendingBalanceMinor)}</strong><p>In their holding period</p></article>
          <article className="balance-card"><span>Total earned</span><strong>{formatEuro(data.totalEarnedMinor)}</strong><p>All confirmed rewards</p></article>
        </div>
      </section>

      <section className="history-section" aria-labelledby="history-title">
        <div className="section-heading"><div><p className="eyebrow">Referral activity</p><h2 id="history-title">Your invitations</h2></div><span>{data.referrals.length} tracked</span></div>
        <ul className="referral-list">
          {data.referrals.map((referral) => <ReferralSummary key={referral.id} referral={referral} patientLabel={referral.patientLabel} />)}
        </ul>
      </section>

      <section className="how-it-works" aria-labelledby="how-title">
        <p className="eyebrow">How it works</p><h2 id="how-title">Three simple steps</h2>
        <ol><li><span>1</span>Share your personal invitation.</li><li><span>2</span>Your friend completes a qualifying consultation.</li><li><span>3</span>After the holding period, withdraw your reward.</li></ol>
      </section>

      <section className="payout-section"><PayoutForm availableBalanceMinor={data.availableBalanceMinor} minimumWithdrawalMinor={data.minimumWithdrawalMinor} action={payoutAction} note={payoutNote} /></section>

      <section className="history-section payout-history" aria-labelledby="payout-title">
        <div className="section-heading"><div><p className="eyebrow">Payout history</p><h2 id="payout-title">Previous payments</h2></div></div>
        {data.payouts.length ? <ul className="referral-list">{data.payouts.map((payout) => <li className="referral-row" key={payout.id}><div><p className="referral-name">Paid 23 Sep 2026</p><p className="referral-detail">Sent to {payout.accountMask}</p></div><div className="referral-reward"><span className="status-pill status-positive">Paid</span><strong>{formatEuro(payout.amountMinor)}</strong></div></li>)}</ul> : <p className="empty-state">Your completed payouts will appear here.</p>}
      </section>
    </main>
  );
}
