import { runPsql } from "./referral-database";

const expectedTables = [
  "referral_users", "referral_codes", "campaigns", "programme_settings", "referral_attributions", "referrals", "referral_events",
  "payout_accounts", "payout_requests", "reward_ledger", "admin_users", "fraud_flags", "admin_audit_log", "webhook_events", "referral_auth_sessions", "referral_handoff_nonces",
];
const expectedIndexes = [
  "referral_codes_one_active_per_user", "campaigns_one_active", "referral_attributions_campaign_created",
  "referral_attributions_public_id_unique", "referral_attributions_journey_context_unique", "referrals_referrer_status",
  "referral_events_referral_occurred", "payout_requests_queue", "reward_ledger_user_effective", "reward_ledger_referral",
  "reward_ledger_one_payout_per_request", "fraud_flags_queue", "admin_audit_log_subject", "webhook_events_pending", "referral_auth_sessions_active_subject", "referral_handoff_nonces_expiry",
];
const expectedTriggers = [
  "referral_users_set_updated_at", "campaigns_set_updated_at", "programme_settings_set_updated_at", "referrals_set_updated_at",
  "referrals_validate_transition", "referrals_snapshot_immutable", "referral_attributions_immutable", "reward_ledger_immutable",
  "referral_events_immutable", "admin_audit_log_immutable", "payout_accounts_set_updated_at", "payout_requests_set_updated_at", "admin_users_set_updated_at",
];

function quoted(values: readonly string[]): string { return values.map((value) => `'${value}'`).join(", "); }

async function main(): Promise<void> {
  const identityOnly = process.argv.includes("--identity-only");
  const query = `
    SELECT 'database=' || current_database()
    UNION ALL SELECT 'public_tables=' || count(*)::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    UNION ALL SELECT 'expected_tables=' || count(*)::text FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${quoted(expectedTables)})
    UNION ALL SELECT 'expected_indexes=' || count(*)::text FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (${quoted(expectedIndexes)})
    UNION ALL SELECT 'expected_triggers=' || count(*)::text
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE NOT trigger.tgisinternal
        AND namespace.nspname = 'public'
        AND relation.relname IN (${quoted(expectedTables)})
        AND trigger.tgname IN (${quoted(expectedTriggers)})
    UNION ALL SELECT 'attribution_snapshot_constraint=' || count(*)::text FROM pg_constraint WHERE conname = 'referral_attributions_public_id_format'
    UNION ALL SELECT 'ledger_immutable_trigger=' || count(*)::text FROM pg_trigger WHERE tgname = 'reward_ledger_immutable'
    UNION ALL SELECT 'primary_keys=' || count(*)::text FROM pg_constraint WHERE contype = 'p' AND connamespace = 'public'::regnamespace
    UNION ALL SELECT 'foreign_keys=' || count(*)::text FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    UNION ALL SELECT 'unique_constraints=' || count(*)::text FROM pg_constraint WHERE contype = 'u' AND connamespace = 'public'::regnamespace
    UNION ALL SELECT 'step112b_fixture_users=' || count(*)::text FROM referral_users WHERE patient_reference LIKE 'test-step112b-concurrency-%';`;
  const output = await runPsql(["-v", "ON_ERROR_STOP=1", "-Atc", query]);
  const values = new Map(output.trim().split("\n").map((line) => line.split("=", 2) as [string, string]));
  console.log([...values.entries()].map(([key, value]) => `${key}=${value}`).join("\n"));
  if (identityOnly) return;
  const checks: Array<[string, string]> = [
    ["expected_tables", String(expectedTables.length)], ["expected_indexes", String(expectedIndexes.length)],
    ["expected_triggers", String(expectedTriggers.length)], ["attribution_snapshot_constraint", "1"], ["ledger_immutable_trigger", "1"],
    ["primary_keys", "16"], ["foreign_keys", "17"], ["unique_constraints", "13"], ["step112b_fixture_users", "0"],
  ];
  for (const [name, expected] of checks) {
    if (values.get(name) !== expected) throw new Error(`Database verification failed: ${name} expected ${expected}, received ${values.get(name) ?? "none"}.`);
  }
  console.log("Database schema verification passed.");
}

void main();
