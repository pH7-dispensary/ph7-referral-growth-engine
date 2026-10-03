import { PortalDashboard } from "@/components/portal/portal-dashboard";
import { requestDemoPortalPayout } from "@/lib/demo/actions";
import { referralDemoModeEnabled } from "@/lib/demo/config";
import { getDemoPortalData } from "@/lib/demo/data";
import { getSyntheticPatientPortalData } from "@/lib/portal/data";
import { requireDevelopmentPatientSession } from "@/lib/portal/dev-access";
import { getPostgresPatientPortalData } from "@/lib/portal/postgres-data";
import { createReferralQrSvg } from "@/lib/portal/qr";
import { currentPatientSession } from "@/lib/auth/server";
import { hasPatientAccess } from "@/lib/auth/authorization";
import { getPostgresExecutor } from "@/lib/persistence/node-postgres";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { payoutStorageConfigured } from "@/lib/portal/payout-encryption";
import { requestPatientPayout } from "@/lib/portal/actions";
import { csrfCookieName } from "@/lib/auth/server";
import { cookies } from "next/headers";

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
    const data = await getPostgresPatientPortalData(getPostgresExecutor(), session.referralUserId);
    if (!data) return <main className="entry-shell"><section className="entry-card"><p className="eyebrow">pH7 Refer</p><h1>Your referral invite is being prepared.</h1><p className="entry-copy">Please try again shortly. If this continues, contact pH7 support.</p></section></main>;
    const qrSvg = await createReferralQrSvg(data.referralUrl);
    return <PortalDashboard data={data} qrSvg={qrSvg}
      payoutAction={payoutStorageConfigured() ? requestPatientPayout : undefined}
      payoutRequestKey={randomUUID()} csrfToken={(await cookies()).get(csrfCookieName("PATIENT"))?.value}
      payoutNote="pH7 reviews withdrawal requests manually before payment." />;
  }
  await requireDevelopmentPatientSession();
  const data = getSyntheticPatientPortalData();
  const qrSvg = await createReferralQrSvg(data.referralUrl);
  return <PortalDashboard data={data} qrSvg={qrSvg} />;
}
