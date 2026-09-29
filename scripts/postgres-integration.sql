-- Runs against the dedicated test database after migrations. Every fixture is
-- synthetic and the transaction is rolled back, leaving no test data behind.
BEGIN;

DO $$
DECLARE
  test_user_id uuid;
  test_code_id uuid;
  test_campaign_id uuid;
  test_attribution_id uuid;
  test_referral_id uuid;
  test_payout_account_id uuid;
  test_payout_request_id uuid;
BEGIN
  INSERT INTO referral_users (patient_reference, email_hash)
  VALUES ('test-step112b-referrer', 'test-hash') RETURNING id INTO test_user_id;
  INSERT INTO referral_codes (referral_user_id, code)
  VALUES (test_user_id, 'STEP112B') RETURNING id INTO test_code_id;
  INSERT INTO campaigns (version, name, is_active, friend_incentive_minor, referrer_reward_minor)
  VALUES (1, 'Step 11.2B synthetic campaign', false, 1000, 1000) RETURNING id INTO test_campaign_id;
  INSERT INTO programme_settings (version, programme_enabled) VALUES (1, true) ON CONFLICT (version) DO NOTHING;
  INSERT INTO referral_attributions (
    referral_code_id, campaign_id, campaign_version, programme_settings_version,
    friend_incentive_minor, referrer_reward_minor, currency, qualification_event,
    holding_period_days, reward_cap_minor, public_id, journey_context_hash
  ) VALUES (
    test_code_id, test_campaign_id, 1, 1, 1000, 1000, 'EUR', 'consultation.paid', 14, NULL,
    'attr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'sha256:step112b-attribution'
  ) RETURNING id INTO test_attribution_id;

  BEGIN
    INSERT INTO referral_attributions (
      referral_code_id, campaign_id, campaign_version, programme_settings_version,
      friend_incentive_minor, referrer_reward_minor, currency, qualification_event,
      holding_period_days, reward_cap_minor, public_id, journey_context_hash
    ) VALUES (
      test_code_id, test_campaign_id, 1, 1, 1000, 1000, 'EUR', 'consultation.paid', 14, NULL,
      'attr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'sha256:step112b-attribution'
    );
    RAISE EXCEPTION 'duplicate attribution context was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE referral_attributions SET referrer_reward_minor = 2000 WHERE id = test_attribution_id;
    RAISE EXCEPTION 'attribution economics mutation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;

  INSERT INTO referrals (
    referrer_user_id, attribution_id, campaign_id, campaign_version, programme_settings_version,
    friend_incentive_minor, referrer_reward_minor, currency, qualification_event, holding_period_days
  ) VALUES (test_user_id, test_attribution_id, test_campaign_id, 1, 1, 1000, 1000, 'EUR', 'consultation.paid', 14)
  RETURNING id INTO test_referral_id;
  UPDATE referrals SET status = 'REGISTERED' WHERE id = test_referral_id;
  BEGIN
    UPDATE referrals SET status = 'PAID' WHERE id = test_referral_id;
    RAISE EXCEPTION 'invalid state transition was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%invalid referral state transition%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE referrals SET referrer_reward_minor = 2000 WHERE id = test_referral_id;
    RAISE EXCEPTION 'referral economics mutation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%economics snapshots are immutable%' THEN RAISE; END IF;
  END;
  INSERT INTO referral_events (referral_id, from_status, to_status, source, idempotency_key)
  VALUES (test_referral_id, 'ATTRIBUTED', 'REGISTERED', 'SYSTEM', 'step112b-referral-event');
  BEGIN
    INSERT INTO referral_events (referral_id, from_status, to_status, source, idempotency_key)
    VALUES (test_referral_id, 'ATTRIBUTED', 'REGISTERED', 'SYSTEM', 'step112b-referral-event');
    RAISE EXCEPTION 'duplicate referral event was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO webhook_events (event_id, event_type, payload_hash)
  VALUES ('step112b-webhook', 'consultation.paid', 'test-payload-hash');
  BEGIN
    INSERT INTO webhook_events (event_id, event_type, payload_hash)
    VALUES ('step112b-webhook', 'consultation.paid', 'test-payload-hash');
    RAISE EXCEPTION 'duplicate webhook event was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO payout_accounts (referral_user_id, account_holder_name, iban_encrypted, iban_last4)
  VALUES (test_user_id, 'Synthetic Test', decode('00010203', 'hex'), 'TEST') RETURNING id INTO test_payout_account_id;
  INSERT INTO payout_requests (referral_user_id, payout_account_id, amount_minor, idempotency_key)
  VALUES (test_user_id, test_payout_account_id, 1000, 'step112b-payout-request') RETURNING id INTO test_payout_request_id;
  INSERT INTO reward_ledger (referral_user_id, referral_id, type, amount_minor, idempotency_key)
  VALUES (test_user_id, test_referral_id, 'CREDIT', 1000, 'step112b-credit');
  BEGIN
    INSERT INTO reward_ledger (referral_user_id, referral_id, type, amount_minor, idempotency_key)
    VALUES (test_user_id, test_referral_id, 'CREDIT', 1000, 'step112b-credit');
    RAISE EXCEPTION 'duplicate ledger idempotency key was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO reward_ledger (referral_user_id, payout_request_id, type, amount_minor, idempotency_key)
  VALUES (test_user_id, test_payout_request_id, 'PAYOUT', -1000, 'step112b-payout-ledger');
  BEGIN
    INSERT INTO reward_ledger (referral_user_id, payout_request_id, type, amount_minor, idempotency_key)
    VALUES (test_user_id, test_payout_request_id, 'PAYOUT', -1000, 'step112b-payout-ledger-duplicate');
    RAISE EXCEPTION 'duplicate payout debit was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE reward_ledger SET status = 'VOID' WHERE idempotency_key = 'step112b-payout-ledger';
    RAISE EXCEPTION 'ledger mutation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;
