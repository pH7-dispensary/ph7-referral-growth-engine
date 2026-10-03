import { AdminConsole } from "@/components/admin/admin-console";
import { FounderDashboard } from "@/components/admin/founder-dashboard";
import { beginLocalAdmin } from "@/lib/local/admin-actions";
import { developmentAdminEnabled, requireLocalAdmin } from "@/lib/local/admin-access";
import { getLocalReferralEngine, type AdminSection } from "@/lib/local/engine";
import { currentAdminSession, csrfCookieName } from "@/lib/auth/server";
import { cookies } from "next/headers";
import { hasAdminAccess } from "@/lib/auth/authorization";
import { notFound, redirect } from "next/navigation";
import { adminCredential } from "@/lib/auth/admin-password";
import { founderSections, getFounderDashboardData, type FounderFilters, type FounderSection } from "@/lib/admin/data";
const tabs = new Set<AdminSection>(["overview", "economics", "campaigns", "referrals", "payouts", "fraud", "audit"]);
export const dynamic = "force-dynamic";
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string,string|undefined>> }) {
  const params = await searchParams;
  const { tab } = params;
  const selectedTab = tabs.has(tab as AdminSection) ? tab as AdminSection : "overview";
  if (!developmentAdminEnabled()) {
    const session = await currentAdminSession();
    if (!hasAdminAccess(session)) { if (adminCredential()) redirect("/admin/login"); notFound(); }
    const csrfToken = (await cookies()).get(csrfCookieName("ADMIN"))?.value ?? "";
    const productionTab = founderSections.includes(tab as FounderSection) ? tab as FounderSection : "overview";
    const filters:FounderFilters={search:params.search,referralStatus:params.status as FounderFilters["referralStatus"],campaignId:params.campaign,from:params.from,to:params.to,page:Number(params.page??1),referralId:params.referral,payoutStatus:params.payoutStatus as FounderFilters["payoutStatus"],fraudStatus:params.fraudStatus as FounderFilters["fraudStatus"],auditSearch:params.auditSearch};
    const data=await getFounderDashboardData(filters);
    return <FounderDashboard data={data} tab={productionTab} csrfToken={csrfToken} filters={filters} result={params.result} error={params.error}/>;
  }
  try { await requireLocalAdmin(); } catch { return <main className="entry-shell"><section className="entry-card"><p className="eyebrow">Founder admin</p><h1>Local founder access</h1><form action={beginLocalAdmin}><button className="button button-dark">Open synthetic admin</button></form></section></main>; }
  return <AdminConsole engine={getLocalReferralEngine()} tab={selectedTab}/>;
}
