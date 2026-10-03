import { PayoutForm } from "@/components/portal/payout-form";
import type { PayoutActionState } from "@/lib/portal/actions";
import { ReferralSummary } from "@/components/portal/referral-summary";
import { ShareActions } from "@/components/portal/share-actions";
import type { PatientPortalData } from "@/lib/portal/data";
import { formatEuro } from "@/lib/portal/format";
import Link from "next/link";

function incentiveLine(data: PatientPortalData): string {
  return `Give ${formatEuro(data.friendIncentiveMinor)}. Get ${formatEuro(data.currentRewardMinor)}.`;
}

function shareCopy(data: PatientPortalData): string {
  return `I've been using pH7 and thought you might find it useful. Use my invitation and you'll get ${formatEuro(data.friendIncentiveMinor)} off your first qualifying consultation.`;
}

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
        <span className="refer-brand">pH7 Refer</span>
      </header>

      <section className="portal-hero" aria-labelledby="welcome-title">
        <p className="eyebrow">pH7 Refer</p>
        <h1 id="welcome-title">{incentiveLine(data)}</h1>
        <p>Invite a friend to pH7. They get {formatEuro(data.friendIncentiveMinor)} off their first qualifying consultation, and you earn {formatEuro(data.currentRewardMinor)} once they complete it.</p>
        {data.environmentLabel ? <span className="test-badge">{data.environmentLabel}</span> : null}
      </section>

      <section className="share-card share-card-primary" aria-labelledby="share-title">
        <div className="section-heading">
          <div><p className="eyebrow">Your personal invite</p><h2 id="share-title">Share your pH7 invitation</h2></div>
        </div>
        <p className="referral-link">{data.referralUrl}</p>
        <ShareActions referralUrl={data.referralUrl} shareText={shareCopy(data)} />
        <p className="subtle-code">Referral code: <span>{data.referralCode}</span></p>
        <div className="qr-area">
          <div aria-label="QR code for your referral link" className="qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p><strong>In person?</strong><br />Let your friend scan this code to open your invitation.</p>
        </div>
      </section>

      <section className="how-it-works" aria-labelledby="how-title">
        <p className="eyebrow">How it works</p><h2 id="how-title">Three simple steps</h2>
        <ol>
          <li><span>1</span><strong>Share your invitation</strong><small>Send your personal pH7 link to a friend.</small></li>
          <li><span>2</span><strong>They book their first consultation</strong><small>They receive their referral benefit when eligible.</small></li>
          <li><span>3</span><strong>You earn {formatEuro(data.currentRewardMinor)}</strong><small>Your reward becomes available after their qualifying consultation is completed and paid.</small></li>
        </ol>
      </section>

      <section aria-labelledby="balance-title">
        <div className="section-heading"><div><p className="eyebrow">Your rewards</p><h2 id="balance-title">Your rewards</h2></div></div>
        <div className="balance-grid">
          <article className="balance-card balance-available"><span>Available</span><strong>{formatEuro(data.availableBalanceMinor)}</strong><p>Ready to withdraw</p></article>
          <article className="balance-card"><span>Pending</span><strong>{formatEuro(data.pendingBalanceMinor)}</strong><p>In their holding period</p></article>
          <article className="balance-card"><span>Lifetime earned</span><strong>{formatEuro(data.totalEarnedMinor)}</strong><p>All confirmed rewards</p></article>
        </div>
      </section>

      <section className="history-section" aria-labelledby="history-title">
        <div className="section-heading"><div><p className="eyebrow">Your referrals</p><h2 id="history-title">Referral activity</h2></div><span>{data.referrals.length} tracked</span></div>
        {data.referrals.length ? (
          <ul className="referral-list">
            {data.referrals.map((referral) => <ReferralSummary key={referral.id} referral={referral} patientLabel={referral.patientLabel} />)}
          </ul>
        ) : (
          <div className="empty-state empty-card">
            <strong>No referrals yet.</strong>
            <p>Share your invitation and your first referral will appear here.</p>
            <ShareActions referralUrl={data.referralUrl} shareText={shareCopy(data)} compact />
          </div>
        )}
      </section>

      <section className="payout-section"><PayoutForm availableBalanceMinor={data.availableBalanceMinor} minimumWithdrawalMinor={data.minimumWithdrawalMinor} action={payoutAction} note={payoutNote} /></section>

      <section className="history-section payout-history" aria-labelledby="payout-title">
        <div className="section-heading"><div><p className="eyebrow">Payout history</p><h2 id="payout-title">Previous payments</h2></div></div>
        {data.payouts.length ? <ul className="referral-list">{data.payouts.map((payout) => <li className="referral-row" key={payout.id}><div><p className="referral-name">{payout.status === "PAID" ? "Paid" : "Requested"} {payout.paidAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) ?? payout.requestedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p><p className="referral-detail">Account ending {payout.accountMask}</p></div><div className="referral-reward"><span className={`status-pill status-${payout.status === "PAID" ? "positive" : payout.status === "REQUESTED" ? "pending" : "muted"}`}>{payout.status.toLowerCase()}</span><strong>{formatEuro(payout.amountMinor)}</strong></div></li>)}</ul> : <p className="empty-state">Your payout requests will appear here.</p>}
      </section>

      <section className="history-section referral-details" aria-labelledby="details-title">
        <details>
          <summary id="details-title">Referral details</summary>
          <ul>
            <li>Your friend must be a new eligible pH7 patient.</li>
            <li>The referral must be attributed through your personal invitation.</li>
            <li>Rewards are earned only after a qualifying paid consultation.</li>
            <li>Cancelled or refunded qualifying consultations may reverse the reward.</li>
            <li>Rewards cannot be earned through self-referral.</li>
            <li>pH7 may review suspicious or duplicate referrals.</li>
          </ul>
        </details>
      </section>
    </main>
  );
}
