-- Phase 11.1: database-readiness safeguards.
-- This migration is PostgreSQL 15+ / Supabase compatible, but is intentionally
-- unapplied. Apply it only to the dedicated Referral Growth Engine database.

-- The public attribution ID is safe to carry through browser redirects and future
-- hand-offs. The database UUID remains internal-only.
ALTER TABLE referral_attributions ADD COLUMN public_id text;
UPDATE referral_attributions
SET public_id = 'attr_' || replace(id::text, '-', '')
WHERE public_id IS NULL;
ALTER TABLE referral_attributions ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE referral_attributions
  ADD CONSTRAINT referral_attributions_public_id_format
  CHECK (public_id ~ '^attr_[a-f0-9]{32}$');
CREATE UNIQUE INDEX referral_attributions_public_id_unique ON referral_attributions (public_id);

-- This is a one-way hash of the local journey + referral-code context, never the
-- browser journey value itself. It makes attribution creation idempotent.
ALTER TABLE referral_attributions ADD COLUMN journey_context_hash text;
UPDATE referral_attributions
SET journey_context_hash = 'legacy:' || id::text
WHERE journey_context_hash IS NULL;
ALTER TABLE referral_attributions ALTER COLUMN journey_context_hash SET NOT NULL;
CREATE UNIQUE INDEX referral_attributions_journey_context_unique
  ON referral_attributions (journey_context_hash);

-- Attribution economics and its public identity are historical facts. Correct an
-- error with a new referral/audit record; do not rewrite this record.
CREATE TRIGGER referral_attributions_immutable
  BEFORE UPDATE OR DELETE ON referral_attributions
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_history_mutation();

-- A payout request can create exactly one debit. This prevents a retry or a
-- concurrent worker from making a second payout debit under a different event key.
CREATE UNIQUE INDEX reward_ledger_one_payout_per_request
  ON reward_ledger (payout_request_id)
  WHERE type = 'PAYOUT';
