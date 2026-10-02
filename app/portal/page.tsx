import { PortalDashboard } from "@/components/portal/portal-dashboard";
import { ShareActions } from "@/components/portal/share-actions";
import { requestDemoPortalPayout } from "@/lib/demo/actions";
import { referralDemoModeEnabled } from "@/lib/demo/config";
import { getDemoPortalData } from "@/lib/demo/data";
import { getSyntheticPatientPortalData } from "@/lib/portal/data";
import { requireDevelopmentPatientSession } from "@/lib/portal/dev-access";
import { createReferralQrSvg } from "@/lib/portal/qr";
import { buildReferralUrl } from "@/lib/portal/referral-link";
import { currentPatientSession } from "@/lib/auth/server";
import { hasPatientAccess } from "@/lib/auth/authorization";
import { PostgresAuthRepository } from "@/lib/auth/postgres";
import { getPostgresExecutor } from "@/lib/persistence/node-postgres";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  if (referralDemoModeEnabled()) {
    const data = await getDemoPortalData();
    const qrSvg = await createReferralQrSvg(data.referralUrl);
    return <PortalDashboard data={data} qrSvg={qrSvg} payoutAction={requestDemoPortalPayout} payoutNote="Staging only: synthetic payout details are validated and stored against the isolated demo database. No banking provider is connected." />;
  }
  if (process.env.NODE_ENV !== "development") {
    const session = await currentPatientSession();
    if (!hasPatientAccess(session)) redirect("/");
    // The session-derived referral user ID is the only identifier used for this
    // query; no patient/reference identifier is accepted from the browser.
    const code = await new PostgresAuthRepository(getPostgresExecutor()).findPatientReferralCode(session.referralUserId);
    if (!code) return <main className="entry-shell"><section className="entry-card"><p className="eyebrow">Referral portal</p><h1>Secure referral session established.</h1><p className="entry-copy">Your referral account is scoped to this verified session; no active referral code is available yet.</p></section></main>;
    const referralUrl = buildReferralUrl(code);
    return (
      <main className="portal-shell">
        <header className="portal-header"><p className="brand" aria-label="pH7 Referral Portal">pH<span>7</span></p><span className="test-badge">Secure patient session</span></header>
        <section className="portal-hero" aria-labelledby="welcome-title">
          <p className="eyebrow">Your referral space</p>
          <h1 id="welcome-title">Invite someone. Share the care.</h1>
          <p>Your referral portal is open from your verified pH7 session. Share your personal invitation below.</p>
        </section>
        <section className="share-card" aria-labelledby="share-title">
          <div className="section-heading"><div><p className="eyebrow">Your invitation</p><h2 id="share-title">Make sharing simple</h2></div><span className="code-chip">{code}</span></div>
          <p className="referral-link">{referralUrl}</p>
          <ShareActions referralUrl={referralUrl} />
        </section>
      </main>
    );
  }
  await requireDevelopmentPatientSession();
  const data = getSyntheticPatientPortalData();
  const qrSvg = await createReferralQrSvg(data.referralUrl);
  return <PortalDashboard data={data} qrSvg={qrSvg} />;
}
