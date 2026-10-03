import { AdminConsole } from "@/components/admin/admin-console";
import { beginLocalAdmin } from "@/lib/local/admin-actions";
import { developmentAdminEnabled, requireLocalAdmin } from "@/lib/local/admin-access";
import { getLocalReferralEngine, type AdminSection } from "@/lib/local/engine";
import { currentAdminSession, csrfCookieName } from "@/lib/auth/server";
import { cookies } from "next/headers";
import { hasAdminAccess } from "@/lib/auth/authorization";
import { notFound, redirect } from "next/navigation";
import { adminCredential } from "@/lib/auth/admin-password";
const tabs = new Set<AdminSection>(["overview", "economics", "campaigns", "referrals", "payouts", "fraud", "audit"]);
export const dynamic = "force-dynamic";
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const selectedTab = tabs.has(tab as AdminSection) ? tab as AdminSection : "overview";
  if (!developmentAdminEnabled()) {
    const session = await currentAdminSession();
    if (!hasAdminAccess(session)) { if (adminCredential()) redirect("/admin/login"); notFound(); }
    const csrfToken = (await cookies()).get(csrfCookieName("ADMIN"))?.value ?? "";
    return <main className="entry-shell"><section className="entry-card"><p className="eyebrow">Founder admin</p><h1>Secure admin session established.</h1><p className="entry-copy">Your private founder access is active. The production operations dashboard is not enabled yet.</p><form action="/admin/logout" method="post"><input type="hidden" name="csrfToken" value={csrfToken} /><button className="button button-dark" type="submit">Sign out</button></form></section></main>;
  }
  try { await requireLocalAdmin(); } catch { return <main className="entry-shell"><section className="entry-card"><p className="eyebrow">Founder admin</p><h1>Local founder access</h1><form action={beginLocalAdmin}><button className="button button-dark">Open synthetic admin</button></form></section></main>; }
  return <AdminConsole engine={getLocalReferralEngine()} tab={selectedTab}/>;
}
