import { NextResponse } from "next/server";
import { FounderPasswordProvider, adminCredential } from "@/lib/auth/admin-password";
import { adminLoginOriginDecision, claimAdminLoginAttempt } from "@/lib/auth/admin-login-policy";
import { getPostgresExecutor } from "@/lib/persistence/node-postgres";
import { getReferralSessionService, writeAdminSession } from "@/lib/auth/server";

export const runtime = "nodejs";
function destination(request: Request) { return process.env.NODE_ENV === "production" ? "https://refer.ph7.health" : new URL(request.url).origin; }
function failure(request: Request) { return NextResponse.redirect(new URL("/admin/login?error=1", destination(request)), { status: 303, headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request) {
  const originDecision = adminLoginOriginDecision(request);
  if (!originDecision.allowed) {
    const fetchSite = request.headers.get("sec-fetch-site");
    const fetchMode = request.headers.get("sec-fetch-mode");
    const fetchDest = request.headers.get("sec-fetch-dest");
    const referrer = request.headers.get("referer");
    const safeContext = originDecision.reason === "opaque-origin" ? {
      fetchSite: ["same-origin", "same-site", "cross-site", "none"].includes(fetchSite ?? "") ? fetchSite : fetchSite ? "other" : "missing",
      fetchMode: fetchMode === "navigate" ? "navigate" : fetchMode ? "other" : "missing",
      fetchDest: fetchDest === "document" ? "document" : fetchDest ? "other" : "missing",
      referrer: referrer === "https://refer.ph7.health/admin/login" ? "canonical-login" : referrer ? "other" : "missing",
    } : undefined;
    console.warn(JSON.stringify({ level: "warning", event: "admin.login.request_rejected", reason: originDecision.reason, ...(safeContext ? { context: safeContext } : {}) }));
    return new Response("Request rejected.", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (originDecision.normalization) console.info(JSON.stringify({ level: "info", event: "admin.login.origin_normalized", reason: originDecision.normalization }));
  if (!adminCredential()) return new Response("Not found.", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return failure(request);
    if (Number(request.headers.get("content-length") ?? 0) > 4096) return failure(request);
    const reader = request.body?.getReader();
    if (!reader) return failure(request);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 4096) { await reader.cancel(); return failure(request); } chunks.push(next.value); }
    if (!await claimAdminLoginAttempt(getPostgresExecutor())) return failure(request);
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    if (form.getAll("email").length !== 1 || form.getAll("password").length !== 1) return failure(request);
    const identity = await new FounderPasswordProvider().verifyAdminIdentity({ email: form.get("email"), password: form.get("password") });
    const session = await getReferralSessionService().beginAdminSession(identity);
    await writeAdminSession(session);
    return NextResponse.redirect(new URL("/admin", destination(request)), { status: 303, headers: { "Cache-Control": "no-store" } });
  } catch { return failure(request); }
}
