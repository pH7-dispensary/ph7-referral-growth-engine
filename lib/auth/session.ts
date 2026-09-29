import "server-only";

import { handoffNonceHash } from "@/lib/auth/handoff";
import { hmacDigest, opaqueToken, secureEqual } from "@/lib/auth/crypto";
import type { AuthRepository, HandoffTokenVerifier, SessionMaterial, SessionSubject, StoredSession, VerifiedAdminIdentity } from "@/lib/auth/types";

export class AuthenticationRejectedError extends Error { constructor() { super("Authentication was rejected."); } }
export class CsrfRejectedError extends Error { constructor() { super("The request could not be authorised."); } }

export class ReferralSessionService {
  constructor(private readonly repository: AuthRepository, private readonly options: { readonly patientSessionSecret: string; readonly adminSessionSecret: string; readonly handoffVerifier: HandoffTokenVerifier; readonly sessionTtlSeconds?: number }) {}

  async beginPatientSession(handoffToken: string, now = new Date()): Promise<SessionMaterial> {
    const handoff = await this.options.handoffVerifier.verify(handoffToken, now);
    const token = opaqueToken();
    const csrfToken = opaqueToken();
    const expiresAt = new Date(Math.min(handoff.expiresAt.getTime(), now.getTime() + (this.options.sessionTtlSeconds ?? 60 * 60) * 1000));
    const subject = await this.repository.consumeHandoffAndCreatePatientSession({
      handoff: { ...handoff, nonce: handoffNonceHash(this.options.patientSessionSecret, handoff.nonce) },
      tokenHash: hmacDigest(this.options.patientSessionSecret, token),
      csrfTokenHash: hmacDigest(this.options.patientSessionSecret, csrfToken),
      expiresAt,
    });
    return { token, csrfToken, expiresAt, subject };
  }

  async beginAdminSession(identity: VerifiedAdminIdentity, now = new Date()): Promise<SessionMaterial> {
    const token = opaqueToken(); const csrfToken = opaqueToken();
    const expiresAt = new Date(now.getTime() + (this.options.sessionTtlSeconds ?? 60 * 60) * 1000);
    const subject = await this.repository.createAdminSession({ identity, tokenHash: hmacDigest(this.options.adminSessionSecret, token), csrfTokenHash: hmacDigest(this.options.adminSessionSecret, csrfToken), expiresAt });
    return { token, csrfToken, expiresAt, subject };
  }

  async readPatientSession(token: string | undefined, now = new Date()): Promise<StoredSession | null> { return this.read(token, this.options.patientSessionSecret, "PATIENT", now); }
  async readAdminSession(token: string | undefined, now = new Date()): Promise<StoredSession | null> { return this.read(token, this.options.adminSessionSecret, "ADMIN", now); }
  async endPatientSession(token: string | undefined): Promise<void> { await this.end(token, this.options.patientSessionSecret); }
  async endAdminSession(token: string | undefined): Promise<void> { await this.end(token, this.options.adminSessionSecret); }

  assertCsrf(session: StoredSession, presented: string | undefined, secret: string): void {
    if (!presented || !secureEqual(session.csrfTokenHash, hmacDigest(secret, presented))) throw new CsrfRejectedError();
  }

  private async read(token: string | undefined, secret: string, subject: SessionSubject["kind"], now: Date): Promise<StoredSession | null> {
    if (!token || token.length > 256) return null;
    const session = await this.repository.findActiveSession(hmacDigest(secret, token), now);
    return session?.kind === subject ? session : null;
  }
  private async end(token: string | undefined, secret: string): Promise<void> { if (token) await this.repository.invalidateSession(hmacDigest(secret, token)); }
}
