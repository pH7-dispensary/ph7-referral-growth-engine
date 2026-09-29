import { runPsql } from "./referral-database";

async function main(): Promise<void> {
  await runPsql(["-v", "ON_ERROR_STOP=1", "-Atqc", `
    BEGIN;
    LOCK TABLE reward_ledger, referral_attributions IN ACCESS EXCLUSIVE MODE;
    ALTER TABLE reward_ledger DISABLE TRIGGER reward_ledger_immutable;
    ALTER TABLE referral_attributions DISABLE TRIGGER referral_attributions_immutable;
    DELETE FROM reward_ledger WHERE referral_user_id IN (SELECT id FROM referral_users WHERE patient_reference LIKE 'test-step112b-concurrency-%');
    DELETE FROM payout_requests WHERE referral_user_id IN (SELECT id FROM referral_users WHERE patient_reference LIKE 'test-step112b-concurrency-%');
    DELETE FROM payout_accounts WHERE referral_user_id IN (SELECT id FROM referral_users WHERE patient_reference LIKE 'test-step112b-concurrency-%');
    DELETE FROM referral_attributions WHERE referral_code_id IN (SELECT code.id FROM referral_codes code JOIN referral_users user_record ON user_record.id = code.referral_user_id WHERE user_record.patient_reference LIKE 'test-step112b-concurrency-%');
    ALTER TABLE referral_attributions ENABLE TRIGGER referral_attributions_immutable;
    ALTER TABLE reward_ledger ENABLE TRIGGER reward_ledger_immutable;
    DELETE FROM referral_codes WHERE referral_user_id IN (SELECT id FROM referral_users WHERE patient_reference LIKE 'test-step112b-concurrency-%');
    DELETE FROM campaigns WHERE name LIKE 'Step 11.2B concurrency %';
    DELETE FROM programme_settings WHERE version = 1122;
    DELETE FROM referral_users WHERE patient_reference LIKE 'test-step112b-concurrency-%';
    COMMIT;`]);
  console.log("Residual Step 11.2B synthetic concurrency fixtures removed.");
}

void main();
