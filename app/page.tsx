import { Logo } from "@/components/logo";
import { isDevelopmentPatientAccessEnabled } from "@/lib/portal/dev-access";
import { beginDevelopmentPatientSession } from "@/lib/portal/dev-actions";
import { openDemoAdmin, openDemoPortal } from "@/lib/demo/actions";
import { referralDemoModeEnabled } from "@/lib/demo/config";
import { demoReferralCode } from "@/lib/demo/data";
import Link from "next/link";

export default function HomePage() {
  const developmentAccess = isDevelopmentPatientAccessEnabled();
  const demoMode = referralDemoModeEnabled();
  if (demoMode) {
    return (
      <main className="review-shell">
        <section className="review-hero">
          <Link className="brand" href="/" aria-label="pH7 Referral Growth Engine"><Logo /></Link>
          <span className="test-badge">Staging environment — synthetic data</span>
          <p className="eyebrow">Referral Growth Engine</p>
          <h1>A complete review environment for the pH7 referral programme.</h1>
          <p className="entry-copy">Explore the patient portal, referred-friend journey, founder controls, and the exact pH7 integration points still waiting for final production details.</p>
        </section>
        <section className="review-grid" aria-label="Review entry points">
          <form action={openDemoPortal} className="review-card">
            <p className="eyebrow">Patient experience</p>
            <h2>View Patient Portal</h2>
            <p>See the current offer, referral link, QR code, balances, history, and withdrawal request flow.</p>
            <button className="button button-dark" type="submit">Open portal</button>
          </form>
          <Link className="review-card" href={`/r/${demoReferralCode}`}>
            <p className="eyebrow">Referred friend experience</p>
            <h2>View Referral Journey</h2>
            <p>Open a synthetic invitation, create attribution, and reach the polished pH7 hand-off boundary.</p>
            <span className="button button-soft">Open invitation</span>
          </Link>
          <form action={openDemoAdmin} className="review-card">
            <p className="eyebrow">Founder experience</p>
            <h2>View Founder Admin</h2>
            <p>Inspect economics, campaigns, referrals, payout queue, fraud review, and audit history.</p>
            <button className="button button-dark" type="submit">Open admin</button>
          </form>
          <Link className="review-card" href="/integration">
            <p className="eyebrow">Integration</p>
            <h2>View Integration Status</h2>
            <p>Review what is ready, what is deliberately unconnected, and what pH7 needs to provide.</p>
            <span className="button button-soft">Open status</span>
          </Link>
        </section>
      </main>
    );
  }
  return (
    <main className="entry-shell">
      <section className="entry-card">
        <Link className="brand" href="/" aria-label="pH7 Referral Portal"><Logo /></Link>
        <p className="eyebrow">Referral portal</p>
        <h1>Good care is worth sharing.</h1>
        <p className="entry-copy">Your referral space is opened securely from pH7. Here you can share your invitation, follow its progress, and manage rewards.</p>
        {developmentAccess ? <form action={beginDevelopmentPatientSession}><button className="button button-dark button-full" type="submit">Open synthetic test portal</button><p className="development-note">Development only · synthetic patient data · no payment or bank connection</p></form> : <p className="entry-note">Secure referral access will open here from pH7.</p>}
      </section>
    </main>
  );
}
