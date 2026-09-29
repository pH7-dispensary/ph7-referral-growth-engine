import { PortalDashboard } from "@/components/portal/portal-dashboard";
import { requestDemoPortalPayout } from "@/lib/demo/actions";
import { referralDemoModeEnabled } from "@/lib/demo/config";
import { getDemoPortalData } from "@/lib/demo/data";
import { getSyntheticPatientPortalData } from "@/lib/portal/data";
import { requireDevelopmentPatientSession } from "@/lib/portal/dev-access";
import { createReferralQrSvg } from "@/lib/portal/qr";
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
    return <main className="entry-shell"><section className="entry-card"><p className="eyebrow">Referral portal</p><h1>Secure referral session established.</h1><p className="entry-copy">Your referral account is scoped to this verified session{code ? "." : "; no active referral code is available yet."}</p></section></main>;
  }
  await requireDevelopmentPatientSession();
  const data = getSyntheticPatientPortalData();
  const qrSvg = await createReferralQrSvg(data.referralUrl);
  return <PortalDashboard data={data} qrSvg={qrSvg} />;
}
