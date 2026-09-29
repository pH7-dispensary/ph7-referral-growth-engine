export type AdminRole = "FOUNDER" | "ADMIN";

export interface VerifiedPatientHandoff {
  readonly patientReference: string;
  readonly emailHash: string;
  readonly issuer: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly nonce: string;
}

export interface VerifiedAdminIdentity {
  readonly emailHash: string;
  readonly role: AdminRole;
}

export type SessionSubject =
  | { readonly kind: "PATIENT"; readonly referralUserId: string; readonly adminUserId?: never }
  | { readonly kind: "ADMIN"; readonly adminUserId: string; readonly referralUserId?: never };

export type StoredSession = SessionSubject & {
  readonly id: string;
  readonly tokenHash: string;
  readonly csrfTokenHash: string;
  readonly expiresAt: Date;
  readonly invalidatedAt: Date | null;
  /** Present only for an ADMIN session and read from the server-side admin record. */
  readonly adminRole?: AdminRole;
};

export interface SessionMaterial {
  /** Opaque browser value. It is never persisted in plaintext. */
  readonly token: string;
  /** Double-submit CSRF value. Its HMAC is retained only server-side. */
  readonly csrfToken: string;
  readonly expiresAt: Date;
  readonly subject: SessionSubject;
}

export interface AuthRepository {
  consumeHandoffAndCreatePatientSession(input: {
    readonly handoff: VerifiedPatientHandoff;
    readonly tokenHash: string;
    readonly csrfTokenHash: string;
    readonly expiresAt: Date;
  }): Promise<SessionSubject>;
  createAdminSession(input: {
    readonly identity: VerifiedAdminIdentity;
    readonly tokenHash: string;
    readonly csrfTokenHash: string;
    readonly expiresAt: Date;
  }): Promise<SessionSubject>;
  findActiveSession(tokenHash: string, now: Date): Promise<StoredSession | null>;
  invalidateSession(tokenHash: string): Promise<void>;
}

/** Provider seam only. No provider token is accepted directly from browser actions. */
export interface AdminIdentityProvider {
  verifyAdminIdentity(input: unknown): Promise<VerifiedAdminIdentity>;
}

/** JWT verifier seam. The future JWKS adapter is injected behind this contract. */
export interface HandoffTokenVerifier {
  verify(token: string, now?: Date): Promise<VerifiedPatientHandoff>;
}
