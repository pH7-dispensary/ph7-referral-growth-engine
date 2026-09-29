-- Phase 2: standalone pH7 Referral Growth Engine domain foundation.
-- PostgreSQL 15+ / Supabase compatible. Apply only to a dedicated referral-engine database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE referral_status AS ENUM ('VISITED', 'ATTRIBUTED', 'REGISTERED', 'BOOKED', 'PAID', 'QUALIFIED', 'PAYABLE', 'PAID_OUT', 'CANCELLED', 'REFUNDED', 'REJECTED', 'FRAUD_REVIEW', 'EXPIRED');
CREATE TYPE ledger_entry_type AS ENUM ('CREDIT', 'PAYOUT', 'REVERSAL');
CREATE TYPE ledger_entry_status AS ENUM ('PENDING', 'EFFECTIVE', 'VOID');
CREATE TYPE payout_request_status AS ENUM ('REQUESTED', 'PAID', 'REJECTED', 'CANCELLED');
CREATE TYPE fraud_flag_type AS ENUM ('SELF_REFERRAL', 'DUPLICATE_REFERRED_USER', 'SAME_DEVICE', 'SUSPICIOUS_IP', 'HIGH_VELOCITY', 'REFUNDED_CONSULTATION', 'DUPLICATE_PAYMENT_EVENT', 'MANUAL_FLAG');
CREATE TYPE fraud_flag_status AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'INVESTIGATING');

CREATE TABLE referral_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_reference text NOT NULL UNIQUE, email_hash text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referral_user_id uuid NOT NULL REFERENCES referral_users(id),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6,16}$'), is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE UNIQUE INDEX referral_codes_one_active_per_user ON referral_codes (referral_user_id) WHERE is_active;

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL CHECK (version > 0), name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false, starts_at timestamptz, ends_at timestamptz,
  friend_incentive_minor bigint NOT NULL CHECK (friend_incentive_minor >= 0), referrer_reward_minor bigint NOT NULL CHECK (referrer_reward_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'), qualification_event text NOT NULL DEFAULT 'consultation.paid',
  holding_period_days integer NOT NULL DEFAULT 0 CHECK (holding_period_days >= 0), reward_cap_minor bigint CHECK (reward_cap_minor IS NULL OR reward_cap_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id, version),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX campaigns_one_active ON campaigns ((is_active)) WHERE is_active;
CREATE TABLE programme_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL UNIQUE CHECK (version > 0), programme_enabled boolean NOT NULL DEFAULT false,
  minimum_withdrawal_minor bigint NOT NULL DEFAULT 0 CHECK (minimum_withdrawal_minor >= 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Economics fields below are a copy, not a live pointer to settings.
CREATE TABLE referral_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referral_code_id uuid NOT NULL REFERENCES referral_codes(id), campaign_id uuid NOT NULL REFERENCES campaigns(id),
  campaign_version integer NOT NULL CHECK (campaign_version > 0), programme_settings_version integer NOT NULL CHECK (programme_settings_version > 0),
  friend_incentive_minor bigint NOT NULL CHECK (friend_incentive_minor >= 0), referrer_reward_minor bigint NOT NULL CHECK (referrer_reward_minor >= 0),
  currency char(3) NOT NULL CHECK (currency = 'EUR'), qualification_event text NOT NULL, holding_period_days integer NOT NULL CHECK (holding_period_days >= 0),
  reward_cap_minor bigint CHECK (reward_cap_minor IS NULL OR reward_cap_minor >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_attributions_campaign_created ON referral_attributions (campaign_id, created_at DESC);
CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referrer_user_id uuid NOT NULL REFERENCES referral_users(id), attribution_id uuid NOT NULL UNIQUE REFERENCES referral_attributions(id),
  referred_patient_reference text UNIQUE, consultation_reference text UNIQUE, status referral_status NOT NULL DEFAULT 'ATTRIBUTED', status_before_fraud_review referral_status,
  campaign_id uuid NOT NULL, campaign_version integer NOT NULL CHECK (campaign_version > 0), programme_settings_version integer NOT NULL CHECK (programme_settings_version > 0),
  friend_incentive_minor bigint NOT NULL CHECK (friend_incentive_minor >= 0), referrer_reward_minor bigint NOT NULL CHECK (referrer_reward_minor >= 0), currency char(3) NOT NULL CHECK (currency = 'EUR'),
  qualification_event text NOT NULL, holding_period_days integer NOT NULL CHECK (holding_period_days >= 0), reward_cap_minor bigint CHECK (reward_cap_minor IS NULL OR reward_cap_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referrals_referrer_status ON referrals (referrer_user_id, status);
CREATE TABLE referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referral_id uuid NOT NULL REFERENCES referrals(id), from_status referral_status, to_status referral_status NOT NULL,
  source text NOT NULL CHECK (source IN ('SYSTEM', 'MANUAL', 'WEBHOOK')), idempotency_key text NOT NULL UNIQUE, occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_events_referral_occurred ON referral_events (referral_id, occurred_at);

CREATE TABLE payout_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referral_user_id uuid NOT NULL REFERENCES referral_users(id), account_holder_name text NOT NULL,
  iban_encrypted bytea NOT NULL, iban_last4 char(4) NOT NULL CHECK (iban_last4 ~ '^[A-Z0-9]{4}$'), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referral_user_id uuid NOT NULL REFERENCES referral_users(id), payout_account_id uuid NOT NULL REFERENCES payout_accounts(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0), currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'), status payout_request_status NOT NULL DEFAULT 'REQUESTED',
  idempotency_key text NOT NULL UNIQUE, requested_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payout_requests_queue ON payout_requests (status, requested_at);
CREATE TABLE reward_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referral_user_id uuid NOT NULL REFERENCES referral_users(id), referral_id uuid REFERENCES referrals(id), payout_request_id uuid REFERENCES payout_requests(id),
  type ledger_entry_type NOT NULL, amount_minor bigint NOT NULL CHECK (amount_minor <> 0), currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  status ledger_entry_status NOT NULL DEFAULT 'EFFECTIVE', idempotency_key text NOT NULL UNIQUE, effective_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'CREDIT' AND amount_minor > 0 AND referral_id IS NOT NULL) OR (type IN ('PAYOUT', 'REVERSAL') AND amount_minor < 0))
);
CREATE INDEX reward_ledger_user_effective ON reward_ledger (referral_user_id, effective_at) WHERE status = 'EFFECTIVE';
CREATE INDEX reward_ledger_referral ON reward_ledger (referral_id) WHERE referral_id IS NOT NULL;

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email_hash text NOT NULL UNIQUE, role text NOT NULL CHECK (role IN ('FOUNDER', 'ADMIN')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fraud_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referral_id uuid NOT NULL REFERENCES referrals(id), type fraud_flag_type NOT NULL, status fraud_flag_status NOT NULL DEFAULT 'OPEN',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb, resolved_by_admin_user_id uuid REFERENCES admin_users(id), created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE INDEX fraud_flags_queue ON fraud_flags (status, created_at);
CREATE TABLE admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_user_id uuid REFERENCES admin_users(id), action text NOT NULL, subject_type text NOT NULL, subject_id uuid,
  before_data jsonb, after_data jsonb, request_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_subject ON admin_audit_log (subject_type, subject_id, created_at DESC);
CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id text NOT NULL, event_type text NOT NULL, payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, processing_error text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (event_id)
);
CREATE INDEX webhook_events_pending ON webhook_events (processed_at) WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION validate_referral_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'VISITED' AND NEW.status IN ('ATTRIBUTED', 'CANCELLED', 'EXPIRED')) OR
    (OLD.status = 'ATTRIBUTED' AND NEW.status IN ('REGISTERED', 'FRAUD_REVIEW', 'CANCELLED', 'EXPIRED')) OR
    (OLD.status = 'REGISTERED' AND NEW.status IN ('BOOKED', 'FRAUD_REVIEW', 'CANCELLED', 'EXPIRED')) OR
    (OLD.status = 'BOOKED' AND NEW.status IN ('PAID', 'FRAUD_REVIEW', 'CANCELLED', 'EXPIRED')) OR
    (OLD.status = 'PAID' AND NEW.status IN ('QUALIFIED', 'FRAUD_REVIEW', 'REFUNDED')) OR
    (OLD.status = 'QUALIFIED' AND NEW.status IN ('PAYABLE', 'FRAUD_REVIEW', 'REFUNDED')) OR
    (OLD.status = 'PAYABLE' AND NEW.status IN ('PAID_OUT', 'FRAUD_REVIEW', 'REFUNDED')) OR
    (OLD.status = 'FRAUD_REVIEW' AND (NEW.status = 'REJECTED' OR NEW.status = OLD.status_before_fraud_review))
  ) THEN RAISE EXCEPTION 'invalid referral state transition: % -> %', OLD.status, NEW.status; END IF;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION prevent_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.campaign_id, OLD.campaign_version, OLD.programme_settings_version, OLD.friend_incentive_minor, OLD.referrer_reward_minor, OLD.currency, OLD.qualification_event, OLD.holding_period_days, OLD.reward_cap_minor)
     IS DISTINCT FROM
     (NEW.campaign_id, NEW.campaign_version, NEW.programme_settings_version, NEW.friend_incentive_minor, NEW.referrer_reward_minor, NEW.currency, NEW.qualification_event, NEW.holding_period_days, NEW.reward_cap_minor)
  THEN RAISE EXCEPTION 'referral economics snapshots are immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER referral_users_set_updated_at BEFORE UPDATE ON referral_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER campaigns_set_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER programme_settings_set_updated_at BEFORE UPDATE ON programme_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER referrals_set_updated_at BEFORE UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER referrals_validate_transition BEFORE UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION validate_referral_transition();
CREATE TRIGGER referrals_snapshot_immutable BEFORE UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();
CREATE TRIGGER payout_accounts_set_updated_at BEFORE UPDATE ON payout_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payout_requests_set_updated_at BEFORE UPDATE ON payout_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER admin_users_set_updated_at BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE FUNCTION prevent_immutable_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only; create a compensating record instead', TG_TABLE_NAME; END; $$;
CREATE TRIGGER reward_ledger_immutable BEFORE UPDATE OR DELETE ON reward_ledger FOR EACH ROW EXECUTE FUNCTION prevent_immutable_history_mutation();
CREATE TRIGGER referral_events_immutable BEFORE UPDATE OR DELETE ON referral_events FOR EACH ROW EXECUTE FUNCTION prevent_immutable_history_mutation();
CREATE TRIGGER admin_audit_log_immutable BEFORE UPDATE OR DELETE ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION prevent_immutable_history_mutation();
