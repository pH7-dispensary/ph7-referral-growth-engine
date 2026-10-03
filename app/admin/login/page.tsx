import { Logo } from "@/components/logo";
import { adminCredential } from "@/lib/auth/admin-password";
import { currentAdminSession } from "@/lib/auth/server";
import { hasAdminAccess } from "@/lib/auth/authorization";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin sign in | pH7 Refer", robots: { index: false, follow: false } };
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!adminCredential()) notFound();
  if (hasAdminAccess(await currentAdminSession())) redirect("/admin");
  const { error } = await searchParams;
  return <main className="entry-shell"><section className="entry-card admin-login-card">
    <Logo /><p className="eyebrow">Private administration</p><h1 className="portal-state-title">Sign in to pH7 Refer</h1>
    <p className="entry-copy">Authorised administrators only.</p>
    <form action="/admin/login/submit" method="post" className="admin-login-form">
      <label>Email<input type="email" name="email" autoComplete="username" required maxLength={254} autoCapitalize="none" spellCheck={false} /></label>
      <label>Password<input type="password" name="password" autoComplete="current-password" required maxLength={1024} /></label>
      {error ? <p role="alert">Unable to sign in. Check your details or try again later.</p> : null}
      <button type="submit" className="button button-dark button-full">Sign in</button>
    </form>
  </section></main>;
}
