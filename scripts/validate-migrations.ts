import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const migrationsDirectory = resolve("db/migrations");
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  const migration = (await Promise.all(files.map((file) => readFile(resolve(migrationsDirectory, file), "utf8")))).join("\n");
  const requiredFragments = [
    "CREATE TABLE referral_users", "CREATE TABLE referral_attributions", "CREATE TABLE referrals",
    "CREATE TABLE reward_ledger", "CREATE TABLE webhook_events", "UNIQUE (event_id)",
    "idempotency_key text NOT NULL UNIQUE", "prevent_immutable_history_mutation", "CREATE TRIGGER reward_ledger_immutable",
    "validate_referral_transition", "CREATE TRIGGER referrals_snapshot_immutable",
    "referral_attributions_public_id_format", "journey_context_hash", "CREATE TRIGGER referral_attributions_immutable",
    "reward_ledger_one_payout_per_request",
    "CREATE TABLE referral_auth_sessions", "CREATE TABLE referral_handoff_nonces",
    "session_token_hash char(64) NOT NULL UNIQUE", "nonce_hash char(64) PRIMARY KEY",
  ];
  const missing = requiredFragments.filter((fragment) => !migration.includes(fragment));
  if (missing.length) throw new Error(`Migration is missing required safeguards: ${missing.join(", ")}`);
  console.log("Migration static validation passed.");
}

void main();
