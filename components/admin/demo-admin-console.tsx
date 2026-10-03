import { Logo } from "@/components/logo";
import Link from "next/link";
import { formatEuro } from "@/lib/portal/format";
import type { DemoAdminData } from "@/lib/demo/data";
import { flagDemoFraud, markDemoPayoutPaid, requestDemoPayout, resolveDemoFraud, saveDemoCampaign } from "@/lib/demo/actions";
import type { AdminSection } from "@/lib/local/engine";

const tabs: AdminSection[] = ["overview", "economics", "campaigns", "referrals", "payouts", "fraud", "audit"];

function Status({ children }: { children: React.ReactNode }) {
  return <span className="status-pill status-neutral">{children}</span>;
}

export function DemoAdminConsole({ data, tab }: { data: DemoAdminData; tab: AdminSection }) {
  const firstReferral = data.referrals[0];
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <Link className="brand" href="/" aria-label="pH7 Referral Growth Engine"><Logo /></Link>
        <span className="test-badge">Staging founder review</span>
      </header>
      <nav className="admin-nav" aria-label="Founder sections">
        {tabs.map((item) => <Link className={item === tab ? "active" : ""} href={`/admin?tab=${item}`} key={item}>{item}</Link>)}
      </nav>
      <section className="admin-content">
        {tab === "overview" ? (
          <>
            <p className="eyebrow">Overview</p>
            <h1>Referral programme command centre</h1>
            <div className="balance-grid">
              <article className="balance-card"><span>Tracked referrals</span><strong>{data.metrics.referralCount}</strong><p>All synthetic journey states</p></article>
              <article className="balance-card"><span>Reward spend</span><strong>{formatEuro(data.metrics.rewardSpendMinor)}</strong><p>Ledger credits only</p></article>
              <article className="balance-card"><span>Outstanding liability</span><strong>{formatEuro(data.metrics.outstandingLiabilityMinor)}</strong><p>Pending credits and review</p></article>
            </div>
            <div className="admin-split">
              <article className="mini-panel"><p className="eyebrow">Funnel</p>{data.funnel.map((row) => <p className="metric-row" key={row.status}><span>{row.status}</span><strong>{row.count}</strong></p>)}</article>
              <article className="mini-panel"><p className="eyebrow">Economics</p><p className="metric-row"><span>Referral CAC</span><strong>{formatEuro(data.metrics.referralCacMinor)}</strong></p><p className="metric-row"><span>Reward / revenue ratio</span><strong>{data.metrics.rewardRevenueRatio}</strong></p><p className="metric-row"><span>Available balance</span><strong>{formatEuro(data.metrics.availableBalanceMinor)}</strong></p></article>
            </div>
          </>
        ) : null}

        {tab === "economics" ? (
          <form action={saveDemoCampaign} className="payout-form">
            <p className="eyebrow">Economics</p>
            <h1>Future referrals only</h1>
            <p className="form-note">Saving creates a new active campaign version. Existing attribution and referral snapshots remain unchanged.</p>
            <label>Friend incentive, cents<input name="friend" defaultValue={data.programme.friendIncentiveMinor} inputMode="numeric" /></label>
            <label>Referrer reward, cents<input name="referrer" defaultValue={data.programme.referrerRewardMinor} inputMode="numeric" /></label>
            <label>Holding period, days<input name="holdingPeriodDays" defaultValue={data.programme.holdingPeriodDays} inputMode="numeric" /></label>
            <label><input name="active" type="checkbox" defaultChecked={data.programme.enabled} /> Programme active</label>
            <button className="button button-dark" type="submit">Save new campaign version</button>
          </form>
        ) : null}

        {tab === "campaigns" ? (
          <>
            <p className="eyebrow">Campaigns</p>
            <h1>Active synthetic offer</h1>
            <div className="review-card review-card-compact">
              <h2>Give {formatEuro(data.programme.friendIncentiveMinor)}, get {formatEuro(data.programme.referrerRewardMinor)}</h2>
              <p>Version {data.programme.version} · {data.programme.qualificationEvent} · {data.programme.holdingPeriodDays} day holding period</p>
              <Status>{data.programme.enabled ? "READY" : "PAUSED"}</Status>
            </div>
          </>
        ) : null}

        {tab === "referrals" ? (
          <>
            <p className="eyebrow">Referrals</p>
            <h1>Synthetic conversion records</h1>
            {data.referrals.map((referral) => (
              <article className="referral-row" key={referral.id}>
                <div><strong>{referral.friendLabel}</strong><p className="referral-detail">{referral.status} · {referral.publicAttributionId}</p></div>
                <div className="referral-reward"><Status>{formatEuro(referral.referrerRewardMinor)} snapshot</Status><strong>{formatEuro(referral.friendIncentiveMinor)} friend</strong></div>
              </article>
            ))}
          </>
        ) : null}

        {tab === "payouts" ? (
          <>
            <p className="eyebrow">Payouts</p>
            <h1>Manual payout queue</h1>
            <form action={requestDemoPayout} className="inline-actions"><input name="amountMinor" type="hidden" value="1000" /><button className="button button-dark">Create synthetic payout request</button></form>
            {data.payouts.map((payout) => (
              <article className="referral-row" key={payout.id}>
                <div><strong>{formatEuro(payout.amountMinor)}</strong><p className="referral-detail">{payout.accountMask} · {payout.status}</p></div>
                {payout.status === "REQUESTED" ? <form action={markDemoPayoutPaid}><input name="payoutId" type="hidden" value={payout.id} /><button className="button button-soft">Mark paid</button></form> : <Status>{payout.paidAt ? "Ledger debit posted" : "Closed"}</Status>}
              </article>
            ))}
          </>
        ) : null}

        {tab === "fraud" ? (
          <>
            <p className="eyebrow">Fraud</p>
            <h1>Review workflow</h1>
            {firstReferral ? <form action={flagDemoFraud} className="inline-actions"><input name="referralId" type="hidden" value={firstReferral.id} /><select name="type"><option>MANUAL_FLAG</option><option>SELF_REFERRAL</option><option>HIGH_VELOCITY</option><option>DUPLICATE_REFERRED_USER</option></select><button className="button button-dark">Create review flag</button></form> : null}
            {data.fraudFlags.map((flag) => (
              <article className="referral-row" key={flag.id}>
                <div><strong>{flag.type}</strong><p className="referral-detail">{flag.status} · referral {flag.referralId.slice(0, 8)}</p></div>
                <form action={resolveDemoFraud}>
                  <input name="flagId" type="hidden" value={flag.id} />
                  <button name="decision" value="INVESTIGATING" className="button button-soft">Investigate</button>
                  <button name="decision" value="APPROVED" className="button button-soft">Approve</button>
                  <button name="decision" value="REJECTED" className="button button-soft">Reject</button>
                </form>
              </article>
            ))}
          </>
        ) : null}

        {tab === "audit" ? (
          <>
            <p className="eyebrow">Audit</p>
            <h1>Append-only admin history</h1>
            {data.audit.map((event) => <article className="referral-row" key={event.id}><div><strong>{event.action}</strong><p className="referral-detail">{event.subjectType} · {event.subjectId?.slice(0, 8) ?? "system"}</p></div><span>{event.createdAt.toLocaleString("en-GB")}</span></article>)}
          </>
        ) : null}
      </section>
    </main>
  );
}
