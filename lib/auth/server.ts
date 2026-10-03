import "server-only";

import { cookies } from "next/headers";
import { requireSessionSecret } from "@/lib/auth/crypto";
import { handoffVerifierFromEnvironment } from "@/lib/auth/handoff";
import { PostgresAuthRepository } from "@/lib/auth/postgres";
import { ReferralSessionService } from "@/lib/auth/session";
import type { HandoffTokenVerifier, SessionMaterial, StoredSession } from "@/lib/auth/types";
import { getPostgresExecutor, referralDatabaseConfigured } from "@/lib/persistence/node-postgres";

const adminSessionCookie = "ph7_referral_admin_session";
const patientSessionCookie = "ph7_referral_patient_session";
const adminCsrfCookie = "ph7_referral_admin_csrf";
const patientCsrfCookie = "ph7_referral_patient_csrf";

type CachedVerifier = { readonly fingerprint: string; readonly verifier: HandoffTokenVerifier };
const verifierCacheKey = "__ph7ReferralHandoffVerifier";

function runtimeHandoffVerifier(): HandoffTokenVerifier {
  const fingerprint = JSON.stringify([
    process.env.PH7_HANDOFF_JWKS_URL,
    process.env.PH7_HANDOFF_ISSUER,
    process.env.PH7_HANDOFF_AUDIENCE,
    process.env.PH7_HANDOFF_ALLOWED_ALGORITHMS,
    process.env.PH7_HANDOFF_MAX_TTL_SECONDS,
  ]);
  const runtime = globalThis as typeof globalThis & { [verifierCacheKey]?: CachedVerifier };
  const cached = runtime[verifierCacheKey];
  if (cached?.fingerprint === fingerprint) return cached.verifier;
  const verifier = handoffVerifierFromEnvironment();
  runtime[verifierCacheKey] = { fingerprint, verifier };
  return verifier;
}

function cookieOptions(expiresAt: Date, httpOnly: boolean) {
  return { httpOnly, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt, priority: "high" as const };
}

export function getReferralSessionService(verifier: HandoffTokenVerifier = runtimeHandoffVerifier()): ReferralSessionService {
  if (!referralDatabaseConfigured()) throw new Error("PostgreSQL persistence is required for authentication.");
  return new ReferralSessionService(new PostgresAuthRepository(getPostgresExecutor()), {
    patientSessionSecret: requireSessionSecret(process.env.PATIENT_SESSION_SECRET, "PATIENT_SESSION_SECRET"),
    adminSessionSecret: requireSessionSecret(process.env.ADMIN_SESSION_SECRET, "ADMIN_SESSION_SECRET"),
    handoffVerifier: verifier,
  });
}

export async function writePatientSession(material: SessionMaterial): Promise<void> {
  const store = await cookies();
  store.set(patientSessionCookie, material.token, cookieOptions(material.expiresAt, true));
  store.set(patientCsrfCookie, material.csrfToken, cookieOptions(material.expiresAt, false));
}

export async function writeAdminSession(material: SessionMaterial): Promise<void> {
  const store = await cookies();
  store.set(adminSessionCookie, material.token, cookieOptions(material.expiresAt, true));
  store.set(adminCsrfCookie, material.csrfToken, cookieOptions(material.expiresAt, false));
}

export async function currentPatientSession(): Promise<StoredSession | null> {
  try { return await getReferralSessionService().readPatientSession((await cookies()).get(patientSessionCookie)?.value); } catch { return null; }
}
export async function currentAdminSession(): Promise<StoredSession | null> {
  try { return await getReferralSessionService().readAdminSession((await cookies()).get(adminSessionCookie)?.value); } catch { return null; }
}
/** End only founder access; preserve any patient referral session in this browser. */
export async function logoutAdminSession(): Promise<void> {
  const store = await cookies();
  await getReferralSessionService().endAdminSession(store.get(adminSessionCookie)?.value);
  store.delete(adminSessionCookie); store.delete(adminCsrfCookie);
}

export async function logoutCurrentSessions(): Promise<void> {
  const store = await cookies();
  try {
    const service = getReferralSessionService();
    await Promise.all([service.endPatientSession(store.get(patientSessionCookie)?.value), service.endAdminSession(store.get(adminSessionCookie)?.value)]);
  } finally {
    store.delete(patientSessionCookie); store.delete(patientCsrfCookie); store.delete(adminSessionCookie); store.delete(adminCsrfCookie);
  }
}

export function csrfCookieName(subject: "PATIENT" | "ADMIN"): string { return subject === "PATIENT" ? patientCsrfCookie : adminCsrfCookie; }

export function assertSessionCsrf(subject: "PATIENT" | "ADMIN", session: StoredSession, presented: string | undefined): void {
  const service = getReferralSessionService();
  const secret = subject === "PATIENT"
    ? requireSessionSecret(process.env.PATIENT_SESSION_SECRET, "PATIENT_SESSION_SECRET")
    : requireSessionSecret(process.env.ADMIN_SESSION_SECRET, "ADMIN_SESSION_SECRET");
  service.assertCsrf(session, presented, secret);
}
