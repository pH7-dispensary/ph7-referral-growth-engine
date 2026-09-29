import { describe, expect, it } from "vitest";
import { hmacDigest } from "@/lib/auth/crypto";
import { HandoffRejectedError, LocalHmacHandoffVerifier, signTestHandoff } from "@/lib/auth/handoff";
import { ReferralSessionService } from "@/lib/auth/session";
import type { AuthRepository, SessionSubject, StoredSession, VerifiedAdminIdentity, VerifiedPatientHandoff } from "@/lib/auth/types";
import { requireAuthorisedAdmin } from "@/lib/runtime/production-actions";
import { verifyWebhookSignature } from "@/lib/webhook/signature";
import { createHmac } from "node:crypto";
import { hasAdminAccess, hasPatientAccess } from "@/lib/auth/authorization";

class MemoryAuthRepository implements AuthRepository {
  private readonly consumedNonces = new Set<string>();
  private readonly sessions = new Map<string, StoredSession>();
  private sequence = 0;
  async consumeHandoffAndCreatePatientSession(input: { handoff: VerifiedPatientHandoff; tokenHash: string; csrfTokenHash: string; expiresAt: Date }): Promise<SessionSubject> {
    if (this.consumedNonces.has(input.handoff.nonce)) throw new Error("Handoff nonce has already been consumed.");
    this.consumedNonces.add(input.handoff.nonce);
    const subject = { kind: "PATIENT" as const, referralUserId: `user-${input.handoff.patientReference}` };
    this.sessions.set(input.tokenHash, { id: `session-${++this.sequence}`, ...subject, tokenHash: input.tokenHash, csrfTokenHash: input.csrfTokenHash, expiresAt: input.expiresAt, invalidatedAt: null });
    return subject;
  }
  async createAdminSession(input: { identity: VerifiedAdminIdentity; tokenHash: string; csrfTokenHash: string; expiresAt: Date }): Promise<SessionSubject> {
    const subject = { kind: "ADMIN" as const, adminUserId: `admin-${input.identity.emailHash}` };
    this.sessions.set(input.tokenHash, { id: `session-${++this.sequence}`, ...subject, tokenHash: input.tokenHash, csrfTokenHash: input.csrfTokenHash, expiresAt: input.expiresAt, invalidatedAt: null });
    return subject;
  }
  async findActiveSession(tokenHash: string, now: Date): Promise<StoredSession | null> { const session = this.sessions.get(tokenHash); return session && !session.invalidatedAt && session.expiresAt > now ? session : null; }
  async invalidateSession(tokenHash: string): Promise<void> { const session = this.sessions.get(tokenHash); if (session) this.sessions.set(tokenHash, { ...session, invalidatedAt: new Date() }); }
}

const issuer = "https://handoff.test.invalid";
const signingSecret = "development-test-handoff-secret-that-is-long-enough";
const patientSecret = "patient-session-secret-for-tests-that-is-long-enough";
const adminSecret = "admin-session-secret-for-tests-that-is-long-enough";
const now = new Date("2026-09-24T12:00:00.000Z");

function service(repository = new MemoryAuthRepository()) {
  return new ReferralSessionService(repository, { patientSessionSecret: patientSecret, adminSessionSecret: adminSecret, handoffVerifier: new LocalHmacHandoffVerifier({ secret: signingSecret, issuer, environment: "test" }) });
}
function token(overrides: Partial<{ issuer: string; issuedAt: Date; expiresAt: Date; nonce: string }> = {}) {
  return signTestHandoff({ issuer: overrides.issuer ?? issuer, patientReference: "synthetic-patient-11-4", emailHash: "a".repeat(64), issuedAt: overrides.issuedAt ?? new Date(now.getTime() - 1_000), expiresAt: overrides.expiresAt ?? new Date(now.getTime() + 60_000), nonce: overrides.nonce ?? "nonce-synthetic-11-4-abcdefghijkl" }, signingSecret);
}

describe("Phase 11.4 hand-off and session foundation", () => {
  it("verifies a signed hand-off, persists only hashes, and expires/invalidate sessions", async () => {
    const repository = new MemoryAuthRepository(); const value = await service(repository).beginPatientSession(token(), now);
    expect(value.subject.kind).toBe("PATIENT"); expect(value.token).not.toContain("synthetic-patient");
    const stored = await repository.findActiveSession(hmacDigest(patientSecret, value.token), now);
    expect(stored?.kind).toBe("PATIENT");
    expect(stored?.tokenHash).not.toBe(value.token); expect(stored?.csrfTokenHash).not.toBe(value.csrfToken);
    service(repository).assertCsrf(stored!, value.csrfToken, patientSecret);
    expect(() => service(repository).assertCsrf(stored!, "wrong", patientSecret)).toThrow();
    await service(repository).endPatientSession(value.token);
    expect(await service(repository).readPatientSession(value.token, now)).toBeNull();
  });

  it("rejects tampered, malformed, expired, wrong-issuer, and future-issued hand-offs", async () => {
    const verifier = new LocalHmacHandoffVerifier({ secret: signingSecret, issuer, environment: "test" });
    await expect(verifier.verify("not-a-jwt", now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(verifier.verify(`${token()}.tampered`, now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(verifier.verify(token({ expiresAt: new Date(now.getTime() - 1) }), now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(verifier.verify(token({ issuer: "https://wrong.invalid" }), now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(verifier.verify(token({ issuedAt: new Date(now.getTime() + 60_000) }), now)).rejects.toBeInstanceOf(HandoffRejectedError);
    expect(() => new LocalHmacHandoffVerifier({ secret: signingSecret, issuer, environment: "production" })).toThrow(HandoffRejectedError);
  });

  it("admits exactly one concurrent use of a nonce and creates a separate admin session", async () => {
    const repository = new MemoryAuthRepository(); const auth = service(repository); const handoff = token({ nonce: "nonce-concurrent-11-4-abcdefghijkl" });
    const attempts = await Promise.allSettled([auth.beginPatientSession(handoff, now), auth.beginPatientSession(handoff, now)]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const admin = await auth.beginAdminSession({ emailHash: "b".repeat(64), role: "FOUNDER" }, now);
    expect(admin.subject.kind).toBe("ADMIN");
    expect(await auth.readPatientSession(admin.token, now)).toBeNull();
    expect((await auth.readAdminSession(admin.token, now))?.kind).toBe("ADMIN");
  });

  it("rejects browser-shaped or roleless actors before any production operation", () => {
    expect(() => requireAuthorisedAdmin({ adminUserId: null, role: null })).toThrow("Admin authorisation is required.");
    expect(() => requireAuthorisedAdmin({ adminUserId: "admin-1", role: null })).toThrow("Admin authorisation is required.");
    expect(requireAuthorisedAdmin({ adminUserId: "admin-1", role: "FOUNDER", requestId: "request-1" })).toEqual({ adminUserId: "admin-1", requestId: "request-1" });
  });

  it("does not authorise an unauthenticated/patient/roleless request as an admin", () => {
    expect(hasAdminAccess(null)).toBe(false);
    expect(hasAdminAccess({ id: "patient", kind: "PATIENT", referralUserId: "user-1", tokenHash: "a", csrfTokenHash: "b", expiresAt: new Date(now.getTime() + 1), invalidatedAt: null })).toBe(false);
    expect(hasAdminAccess({ id: "roleless", kind: "ADMIN", adminUserId: "admin-1", tokenHash: "a", csrfTokenHash: "b", expiresAt: new Date(now.getTime() + 1), invalidatedAt: null })).toBe(false);
    const patient = { id: "patient", kind: "PATIENT" as const, referralUserId: "user-1", tokenHash: "a", csrfTokenHash: "b", expiresAt: new Date(now.getTime() + 1), invalidatedAt: null };
    expect(hasPatientAccess(patient)).toBe(true);
  });

  it("uses no local engine state to verify configured webhook signatures", () => {
    const body = '{"event_id":"synthetic"}'; const secret = "webhook-secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(body, signature, undefined)).toBe(false);
    expect(verifyWebhookSignature(body, `${signature}00`, secret)).toBe(false);
  });
});
