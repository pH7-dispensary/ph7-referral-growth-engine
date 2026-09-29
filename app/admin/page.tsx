import { AdminConsole } from "@/components/admin/admin-console";
import { DemoAdminConsole } from "@/components/admin/demo-admin-console";
import { referralDemoModeEnabled } from "@/lib/demo/config";
import { getDemoAdminData } from "@/lib/demo/data";
import { beginLocalAdmin } from "@/lib/local/admin-actions";
import { developmentAdminEnabled, requireLocalAdmin } from "@/lib/local/admin-access";
import { getLocalReferralEngine, type AdminSection } from "@/lib/local/engine";
import { currentAdminSession } from "@/lib/auth/server";
import { hasAdminAccess } from "@/lib/auth/authorization";
import { notFound } from "next/navigation";
const tabs = new Set<AdminSection>(["overview", "economics", "campaigns", "referrals", "payouts", "fraud", "audit"]);
export const dynamic = "force-dynamic";
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const selectedTab = tabs.has(tab as AdminSection) ? tab as AdminSection : "overview";
  if (referralDemoModeEnabled()) {
    return <DemoAdminConsole data={await getDemoAdminData()} tab={selectedTab} />;
  }
  if (!developmentAdminEnabled()) {
    const session = await currentAdminSession();
    if (!hasAdminAccess(session)) notFound();
    return <main className="entry-shell"><section className="entry-card"><p className="eyebrow">Founder admin</p><h1>Secure admin session established.</h1><p className="entry-copy">Operational actions resolve this server-side session and its persisted role. Production admin UI composition remains intentionally unavailable until a separately authorised identity provider is connected.</p></section></main>;
  }
  try { await requireLocalAdmin(); } catch { return <main className="entry-shell"><section className="entry-card"><p className="eyebrow">Founder admin</p><h1>Local founder access</h1><form action={beginLocalAdmin}><button className="button button-dark">Open synthetic admin</button></form></section></main>; }
  return <AdminConsole engine={getLocalReferralEngine()} tab={selectedTab}/>;
}
