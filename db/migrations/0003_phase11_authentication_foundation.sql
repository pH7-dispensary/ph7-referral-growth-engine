-- Phase 11.4: isolated Referral Growth Engine authentication foundation.
-- Apply only to the dedicated Referral Growth Engine PostgreSQL database.

CREATE TYPE referral_session_subject AS ENUM ('PATIENT', 'ADMIN');

CREATE TABLE referral_auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type referral_session_subject NOT NULL,
  referral_user_id uuid REFERENCES referral_users(id),
  admin_user_id uuid REFERENCES admin_users(id),
  session_token_hash char(64) NOT NULL UNIQUE,
  csrf_token_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (subject_type = 'PATIENT' AND referral_user_id IS NOT NULL AND admin_user_id IS NULL)
    OR (subject_type = 'ADMIN' AND admin_user_id IS NOT NULL AND referral_user_id IS NULL)
  )
);
CREATE INDEX referral_auth_sessions_active_subject
  ON referral_auth_sessions (subject_type, referral_user_id, admin_user_id, expires_at)
  WHERE invalidated_at IS NULL;

-- Only an HMAC of the verified nonce is retained. A duplicate insert is the
-- atomic single-use/replay barrier across requests, processes, and restarts.
CREATE TABLE referral_handoff_nonces (
  nonce_hash char(64) PRIMARY KEY,
  issuer text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at - interval '1 minute')
);
CREATE INDEX referral_handoff_nonces_expiry ON referral_handoff_nonces (expires_at);
