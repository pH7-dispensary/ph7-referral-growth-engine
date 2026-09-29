import "server-only";

import type { AuthRepository, SessionSubject, StoredSession, VerifiedAdminIdentity, VerifiedPatientHandoff } from "@/lib/auth/types";
import type { SqlExecutor } from "@/lib/persistence/postgres";

type SessionRow = {
  id: string;
  subject_type: "PATIENT" | "ADMIN";
  referral_user_id: string | null;
  admin_user_id: string | null;
  session_token_hash: string;
  csrf_token_hash: string;
  expires_at: Date | string;
  invalidated_at: Date | string | null;
  admin_role: "FOUNDER" | "ADMIN" | null;
};

function subjectFromRow(row: Pick<SessionRow, "subject_type" | "referral_user_id" | "admin_user_id">): SessionSubject {
  if (row.subject_type === "PATIENT" && row.referral_user_id) return { kind: "PATIENT", referralUserId: row.referral_user_id };
  if (row.subject_type === "ADMIN" && row.admin_user_id) return { kind: "ADMIN", adminUserId: row.admin_user_id };
  throw new Error("Stored session subject is invalid.");
}

/** PostgreSQL implementation; all token and nonce inputs are already one-way HMACs. */
export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async consumeHandoffAndCreatePatientSession(input: { readonly handoff: VerifiedPatientHandoff; readonly tokenHash: string; readonly csrfTokenHash: string; readonly expiresAt: Date }): Promise<SessionSubject> {
    return this.sql.transaction(async (tx) => {
      const nonce = await tx.query<{ nonce_hash: string }>(
        "INSERT INTO referral_handoff_nonces (nonce_hash, issuer, expires_at, consumed_at) VALUES ($1,$2,$3,now()) ON CONFLICT (nonce_hash) DO NOTHING RETURNING nonce_hash",
        [input.handoff.nonce, input.handoff.issuer, input.handoff.expiresAt],
      );
      if (!nonce.rows[0]) throw new Error("Handoff nonce has already been consumed.");
      const user = await tx.query<{ id: string }>(
        "INSERT INTO referral_users (patient_reference,email_hash) VALUES ($1,$2) ON CONFLICT (patient_reference) DO UPDATE SET email_hash=EXCLUDED.email_hash RETURNING id",
        [input.handoff.patientReference, input.handoff.emailHash],
      );
      const referralUserId = user.rows[0]?.id;
      if (!referralUserId) throw new Error("Referral user could not be resolved.");
      await tx.query(
        "INSERT INTO referral_auth_sessions (subject_type,referral_user_id,session_token_hash,csrf_token_hash,expires_at) VALUES ('PATIENT',$1,$2,$3,$4)",
        [referralUserId, input.tokenHash, input.csrfTokenHash, input.expiresAt],
      );
      return { kind: "PATIENT", referralUserId };
    });
  }

  async createAdminSession(input: { readonly identity: VerifiedAdminIdentity; readonly tokenHash: string; readonly csrfTokenHash: string; readonly expiresAt: Date }): Promise<SessionSubject> {
    return this.sql.transaction(async (tx) => {
      const admin = await tx.query<{ id: string }>(
        "INSERT INTO admin_users (email_hash,role) VALUES ($1,$2) ON CONFLICT (email_hash) DO UPDATE SET role=EXCLUDED.role RETURNING id",
        [input.identity.emailHash, input.identity.role],
      );
      const adminUserId = admin.rows[0]?.id;
      if (!adminUserId) throw new Error("Admin user could not be resolved.");
      await tx.query(
        "INSERT INTO referral_auth_sessions (subject_type,admin_user_id,session_token_hash,csrf_token_hash,expires_at) VALUES ('ADMIN',$1,$2,$3,$4)",
        [adminUserId, input.tokenHash, input.csrfTokenHash, input.expiresAt],
      );
      return { kind: "ADMIN", adminUserId };
    });
  }

  async findActiveSession(tokenHash: string, now: Date): Promise<StoredSession | null> {
    const result = await this.sql.query<SessionRow>(
      "SELECT session.id,session.subject_type,session.referral_user_id,session.admin_user_id,session.session_token_hash,session.csrf_token_hash,session.expires_at,session.invalidated_at,admin.role AS admin_role FROM referral_auth_sessions session LEFT JOIN admin_users admin ON admin.id=session.admin_user_id WHERE session.session_token_hash=$1 AND session.invalidated_at IS NULL AND session.expires_at > $2",
      [tokenHash, now],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, ...subjectFromRow(row), tokenHash: row.session_token_hash, csrfTokenHash: row.csrf_token_hash, expiresAt: new Date(row.expires_at), invalidatedAt: row.invalidated_at ? new Date(row.invalidated_at) : null, ...(row.admin_role ? { adminRole: row.admin_role } : {}) };
  }

  async invalidateSession(tokenHash: string): Promise<void> {
    await this.sql.query("UPDATE referral_auth_sessions SET invalidated_at=COALESCE(invalidated_at,now()) WHERE session_token_hash=$1", [tokenHash]);
  }

  async findPatientReferralCode(referralUserId: string): Promise<string | null> {
    const result = await this.sql.query<{ code: string }>("SELECT code FROM referral_codes WHERE referral_user_id=$1 AND is_active=true LIMIT 1", [referralUserId]);
    return result.rows[0]?.code ?? null;
  }
}
