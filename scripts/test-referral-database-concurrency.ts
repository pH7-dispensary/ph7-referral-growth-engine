import { randomUUID } from "node:crypto";
import { runPsql } from "./referral-database";

const token = randomUUID().replaceAll("-", "");
const patientReference = `test-step112b-concurrency-${token}`;
const code = `C${token.slice(0, 11).toUpperCase()}`;
const campaignName = `Step 11.2B concurrency ${token}`;
const contextHash = `sha256:step112b-concurrency:${token}`;
const attributionOne = `attr_${token}`;
const attributionTwo = `attr_${randomUUID().replaceAll("-", "")}`;
const settingVersion = 1122;
const payoutIdempotencyOne = `step112b-payout-${token}`;
const payoutIdempotencyTwo = `step112b-payout-${randomUUID().replaceAll("-", "")}`;

const psql = (statement: string) => runPsql(["-v", "ON_ERROR_STOP=1", "-Atqc", statement]);
const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function main(): Promise<void> {
  let userId = "";
  let codeId = "";
  let campaignId = "";
  let payoutRequestId = "";
  try {
    userId = (await psql(`INSERT INTO referral_users (patient_reference, email_hash) VALUES ('${patientReference}', 'test-hash') RETURNING id;`)).trim();
    codeId = (await psql(`INSERT INTO referral_codes (referral_user_id, code) VALUES ('${userId}', '${code}') RETURNING id;`)).trim();
    campaignId = (await psql(`INSERT INTO campaigns (version, name, is_active, friend_incentive_minor, referrer_reward_minor) VALUES (1, '${campaignName}', false, 1000, 1000) RETURNING id;`)).trim();
    await psql(`INSERT INTO programme_settings (version, programme_enabled) VALUES (${settingVersion}, true);`);

    const firstAttribution = runPsql(["-v", "ON_ERROR_STOP=1", "-Atqc", `
      BEGIN;
      INSERT INTO referral_attributions (referral_code_id, campaign_id, campaign_version, programme_settings_version, friend_incentive_minor, referrer_reward_minor, currency, qualification_event, holding_period_days, public_id, journey_context_hash)
      VALUES ('${codeId}', '${campaignId}', 1, ${settingVersion}, 1000, 1000, 'EUR', 'consultation.paid', 14, '${attributionOne}', '${contextHash}')
      ON CONFLICT DO NOTHING RETURNING public_id;
      SELECT pg_sleep(1);
      COMMIT;`]);
    await pause(100);
    const secondAttribution = await psql(`
      INSERT INTO referral_attributions (referral_code_id, campaign_id, campaign_version, programme_settings_version, friend_incentive_minor, referrer_reward_minor, currency, qualification_event, holding_period_days, public_id, journey_context_hash)
      VALUES ('${codeId}', '${campaignId}', 1, ${settingVersion}, 1000, 1000, 'EUR', 'consultation.paid', 14, '${attributionTwo}', '${contextHash}')
      ON CONFLICT DO NOTHING RETURNING public_id;`);
    const firstAttributionOutput = await firstAttribution;
    if (!firstAttributionOutput.includes(attributionOne) || secondAttribution.includes(attributionTwo)) {
      throw new Error("Concurrent attribution idempotency protection failed.");
    }

    const payoutAccountId = (await psql(`INSERT INTO payout_accounts (referral_user_id, account_holder_name, iban_encrypted, iban_last4) VALUES ('${userId}', 'Synthetic Test', decode('00010203', 'hex'), 'TEST') RETURNING id;`)).trim();
    payoutRequestId = (await psql(`INSERT INTO payout_requests (referral_user_id, payout_account_id, amount_minor, idempotency_key) VALUES ('${userId}', '${payoutAccountId}', 1000, 'step112b-request-${token}') RETURNING id;`)).trim();
    const firstPayout = runPsql(["-v", "ON_ERROR_STOP=1", "-Atqc", `
      BEGIN;
      INSERT INTO reward_ledger (referral_user_id, payout_request_id, type, amount_minor, idempotency_key)
      VALUES ('${userId}', '${payoutRequestId}', 'PAYOUT', -1000, '${payoutIdempotencyOne}')
      ON CONFLICT DO NOTHING RETURNING id;
      SELECT pg_sleep(1);
      COMMIT;`]);
    await pause(100);
    const secondPayout = await psql(`
      INSERT INTO reward_ledger (referral_user_id, payout_request_id, type, amount_minor, idempotency_key)
      VALUES ('${userId}', '${payoutRequestId}', 'PAYOUT', -1000, '${payoutIdempotencyTwo}')
      ON CONFLICT DO NOTHING RETURNING id;`);
    const firstPayoutOutput = await firstPayout;
    if (!firstPayoutOutput.trim() || secondPayout.trim()) throw new Error("Concurrent payout ledger protection failed.");

    console.log("PostgreSQL concurrent attribution and payout idempotency tests passed.");
  } finally {
    // The attribution trigger deliberately prevents ordinary deletion. This
    // locked transaction never commits the trigger as disabled: it removes only
    // this random-token fixture and reenables the trigger before commit.
    await psql(`
      BEGIN;
      LOCK TABLE reward_ledger, referral_attributions IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE reward_ledger DISABLE TRIGGER reward_ledger_immutable;
      ALTER TABLE referral_attributions DISABLE TRIGGER referral_attributions_immutable;
      DELETE FROM reward_ledger WHERE referral_user_id = '${userId}';
      ${payoutRequestId ? `DELETE FROM payout_requests WHERE id = '${payoutRequestId}';` : ""}
      DELETE FROM payout_accounts WHERE referral_user_id = '${userId}';
      DELETE FROM referral_attributions WHERE journey_context_hash = '${contextHash}';
      ALTER TABLE referral_attributions ENABLE TRIGGER referral_attributions_immutable;
      ALTER TABLE reward_ledger ENABLE TRIGGER reward_ledger_immutable;
      DELETE FROM referral_codes WHERE id = '${codeId}';
      DELETE FROM campaigns WHERE id = '${campaignId}';
      DELETE FROM programme_settings WHERE version = ${settingVersion};
      DELETE FROM referral_users WHERE id = '${userId}';
      COMMIT;`);
  }
}

void main();
