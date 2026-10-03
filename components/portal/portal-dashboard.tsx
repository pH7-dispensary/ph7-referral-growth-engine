import { Logo } from "@/components/logo";
import { PayoutForm } from "@/components/portal/payout-form";
import type { PayoutActionState } from "@/lib/portal/actions";
import { ReferralSummary } from "@/components/portal/referral-summary";
import { ShareActions } from "@/components/portal/share-actions";
import type { PatientPortalData } from "@/lib/portal/data";
import { formatEuro } from "@/lib/portal/format";
import Link from "next/link";
import { withdrawalPresentation } from "@/lib/portal/withdrawal";
import { Disclosure } from "@/components/portal/disclosure";

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
  const withdrawal = withdrawalPresentation(data.availableBalanceMinor, data.minimumWithdrawalMinor, Boolean(payoutAction));
  return (
    <main className="portal-shell">
      <a className="portal-skip-link" href="#invite">Skip to your invitation</a>
      <header className="portal-header">
        <Link className="brand" href="/portal" aria-label="pH7 Referral Portal"><Logo /></Link>
        <nav className="portal-nav" aria-label="Your referral space"><a href="#rewards">Rewards</a><a href="#activity">Activity</a></nav>
      </header>

      <div className="portal-intro">
      <section className="portal-hero" aria-labelledby="welcome-title">
        <p className="eyebrow">pH7 Refer</p>
        <h1 id="welcome-title"><span>Give {formatEuro(data.friendIncentiveMinor)}.</span> <span>Get {formatEuro(data.currentRewardMinor)}.</span></h1>
        <p>Give a friend {formatEuro(data.friendIncentiveMinor)} off their first qualifying consultation. You’ll earn {formatEuro(data.currentRewardMinor)} after they complete and pay for it.</p>
        <a className="portal-text-link" href="#how-title">How your reward works <span aria-hidden="true">↗</span></a>
      </section>

      <section id="invite" tabIndex={-1} className="share-card share-card-primary" aria-labelledby="share-title">
        <div className="section-heading">
          <h2 id="share-title" className="invite-label">Your personal invite</h2>
        </div>
        <p className="referral-link" aria-label="Your referral link">{data.referralUrl}</p>
        <ShareActions referralUrl={data.referralUrl} shareText={shareCopy(data)} />
        <p className="subtle-code">Referral code: <span>{data.referralCode}</span></p>
        <Disclosure className="qr-disclosure" summary="Sharing in person? Show QR code">
          <div className="qr-area">
          <div role="img" aria-label="QR code for your referral link" className="qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p><strong>In person?</strong><br />Let your friend scan this code to open your invitation.</p>
        </div>
        </Disclosure>
      </section>
      </div>

      <section id="rewards" tabIndex={-1} className="portal-rewards" aria-labelledby="balance-title">
        <div className="section-heading"><h2 id="balance-title">Your rewards</h2></div>
        <div className="balance-grid">
          <article className="balance-card balance-available"><span>Available</span><strong>{formatEuro(data.availableBalanceMinor)}</strong>
            <p>{withdrawal.reason}</p>
            <a className={withdrawal.canRequest ? "button button-dark withdrawal-cta" : "portal-text-link"} href="#withdrawal">{withdrawal.canRequest ? `Withdraw ${formatEuro(data.availableBalanceMinor)}` : "Withdrawal information"}</a>
          </article>
          <article className="balance-card"><span>Pending</span><strong>{formatEuro(data.pendingBalanceMinor)}</strong><p>Awaiting release</p></article>
          <article className="balance-card"><span>Lifetime earned</span><strong>{formatEuro(data.totalEarnedMinor)}</strong><p>Includes pending rewards</p></article>
        </div>
      </section>

      <section id="activity" tabIndex={-1} className="history-section" aria-labelledby="history-title">
        <div className="section-heading"><h2 id="history-title">Referral activity</h2><span>{data.referrals.length} {data.referrals.length === 1 ? "referral" : "referrals"}</span></div>
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

      <div className="portal-payment-grid">
      <section id="withdrawal" tabIndex={-1} className="payout-section" aria-label="Withdraw rewards"><PayoutForm availableBalanceMinor={data.availableBalanceMinor} minimumWithdrawalMinor={data.minimumWithdrawalMinor} action={payoutAction} note={payoutNote} /></section>

      <section className="history-section payout-history" aria-labelledby="payout-title">
        <div className="section-heading"><h2 id="payout-title">Payout history</h2></div>
        {data.payouts.length ? <ul className="referral-list">{data.payouts.map((payout) => <li className="referral-row" key={payout.id}><div><p className="referral-name">{payout.status === "PAID" ? "Paid" : "Requested"} {payout.paidAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) ?? payout.requestedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p><p className="referral-detail">Account ending {payout.accountMask}</p></div><div className="referral-reward"><span className={`status-pill status-${payout.status === "PAID" ? "positive" : payout.status === "REQUESTED" ? "pending" : "muted"}`}>{payout.status.toLowerCase()}</span><strong>{formatEuro(payout.amountMinor)}</strong></div></li>)}</ul> : <p className="empty-state">Your payout requests will appear here.</p>}
      </section>
      </div>

      <section className="how-it-works" aria-labelledby="how-title">
        <h2 id="how-title" tabIndex={-1}>How your reward works</h2>
        <ol>
          <li><span aria-hidden="true">1</span><div><strong>Share your invitation</strong><small>Send your personal link to a friend who is new to pH7.</small></div></li>
          <li><span aria-hidden="true">2</span><div><strong>They complete a consultation</strong><small>Your friend receives their benefit when eligible.</small></div></li>
          <li><span aria-hidden="true">3</span><div><strong>You earn {formatEuro(data.currentRewardMinor)}</strong><small>After the qualifying paid consultation, your reward has a {data.holdingPeriodDays}-day holding period before release.</small></div></li>
        </ol>
      </section>

      <section className="history-section referral-details" aria-labelledby="details-title">
        <Disclosure summary="Referral details" summaryId="details-title">
          <ul>
            <li>Your friend must be a new eligible pH7 patient.</li>
            <li>The referral must be attributed through your personal invitation.</li>
            <li>Rewards are earned only after a qualifying paid consultation.</li>
            <li>Cancelled or refunded qualifying consultations may reverse the reward.</li>
            <li>Rewards cannot be earned through self-referral.</li>
            <li>pH7 may review suspicious or duplicate referrals.</li>
          </ul>
        </Disclosure>
      </section>
      <footer className="portal-footer">pH7 Refer <span>Your friends’ personal details stay private.</span></footer>
    </main>
  );
}
