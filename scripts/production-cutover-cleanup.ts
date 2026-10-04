import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd());

type Counts = Record<string, number>;

const exactPatientReferences = [
  "demo-review-ava-v1",
  "preview-synthetic-referrer-v1",
  "pat_eu_0",
] as const;
const demoAdminEmailHash = createHash("sha256").update("founder-demo@ph7.example").digest("hex");

async function rows<T extends QueryResultRow>(client: PoolClient, statement: string, parameters: readonly unknown[] = []): Promise<T[]> {
  return (await client.query<T>(statement, [...parameters])).rows;
}

async function counts(client: PoolClient): Promise<Counts> {
  const result = await rows<{ name: string; count: string }>(client, `
    WITH target_users AS (
      SELECT id FROM referral_users
      WHERE patient_reference=ANY($1::text[]) OR patient_reference LIKE 'test-step113-%'
    ), target_codes AS (
      SELECT id FROM referral_codes WHERE referral_user_id IN (SELECT id FROM target_users)
    ), target_attributions AS (
      SELECT id FROM referral_attributions WHERE referral_code_id IN (SELECT id FROM target_codes)
    ), target_referrals AS (
      SELECT id FROM referrals
      WHERE referrer_user_id IN (SELECT id FROM target_users)
         OR attribution_id IN (SELECT id FROM target_attributions)
    ), target_admins AS (
      SELECT id FROM admin_users WHERE email_hash=$2
    )
    SELECT 'referral_users' AS name, count(*)::text FROM target_users
    UNION ALL SELECT 'referral_codes', count(*)::text FROM target_codes
    UNION ALL SELECT 'referral_attributions', count(*)::text FROM target_attributions
    UNION ALL SELECT 'referrals', count(*)::text FROM target_referrals
    UNION ALL SELECT 'referral_events', count(*)::text FROM referral_events WHERE referral_id IN (SELECT id FROM target_referrals)
    UNION ALL SELECT 'reward_ledger', count(*)::text FROM reward_ledger WHERE referral_user_id IN (SELECT id FROM target_users) OR referral_id IN (SELECT id FROM target_referrals)
    UNION ALL SELECT 'payout_accounts', count(*)::text FROM payout_accounts WHERE referral_user_id IN (SELECT id FROM target_users)
    UNION ALL SELECT 'payout_requests', count(*)::text FROM payout_requests WHERE referral_user_id IN (SELECT id FROM target_users)
    UNION ALL SELECT 'fraud_flags', count(*)::text FROM fraud_flags WHERE referral_id IN (SELECT id FROM target_referrals)
    UNION ALL SELECT 'patient_sessions', count(*)::text FROM referral_auth_sessions WHERE referral_user_id IN (SELECT id FROM target_users)
    UNION ALL SELECT 'demo_admin_users', count(*)::text FROM target_admins
    UNION ALL SELECT 'demo_admin_sessions', count(*)::text FROM referral_auth_sessions WHERE admin_user_id IN (SELECT id FROM target_admins)
    UNION ALL SELECT 'demo_audit', count(*)::text FROM admin_audit_log
      WHERE admin_user_id IN (SELECT id FROM target_admins)
         OR request_id LIKE 'demo%'
         OR action LIKE 'DEMO_%'
  `, [exactPatientReferences, demoAdminEmailHash]);
  return Object.fromEntries(result.map((row) => [row.name, Number(row.count)]));
}

async function targetIds(client: PoolClient): Promise<Record<string, string[]>> {
  const result = await rows<{ kind: string; id: string }>(client, `
    WITH target_users AS (
      SELECT id FROM referral_users
      WHERE patient_reference=ANY($1::text[]) OR patient_reference LIKE 'test-step113-%'
    ), target_codes AS (
      SELECT id FROM referral_codes WHERE referral_user_id IN (SELECT id FROM target_users)
    ), target_attributions AS (
      SELECT id FROM referral_attributions WHERE referral_code_id IN (SELECT id FROM target_codes)
    ), target_referrals AS (
      SELECT id FROM referrals
      WHERE referrer_user_id IN (SELECT id FROM target_users)
         OR attribution_id IN (SELECT id FROM target_attributions)
    )
    SELECT 'referral_user' AS kind, id::text FROM target_users
    UNION ALL SELECT 'referral', id::text FROM target_referrals
    UNION ALL SELECT 'attribution', id::text FROM target_attributions
    UNION ALL SELECT 'ledger', id::text FROM reward_ledger WHERE referral_user_id IN (SELECT id FROM target_users) OR referral_id IN (SELECT id FROM target_referrals)
  `, [exactPatientReferences]);
  return result.reduce<Record<string, string[]>>((all, row) => {
    (all[row.kind] ??= []).push(row.id);
    return all;
  }, {});
}

async function deleteConfirmedSyntheticGraph(client: PoolClient): Promise<void> {
  await client.query(`CREATE TEMP TABLE cutover_target_users ON COMMIT DROP AS
    SELECT id FROM referral_users
    WHERE patient_reference=ANY($1::text[]) OR patient_reference LIKE 'test-step113-%'`, [exactPatientReferences]);
  await client.query(`CREATE TEMP TABLE cutover_target_codes ON COMMIT DROP AS
    SELECT id FROM referral_codes WHERE referral_user_id IN (SELECT id FROM cutover_target_users)`);
  await client.query(`CREATE TEMP TABLE cutover_target_attributions ON COMMIT DROP AS
    SELECT id FROM referral_attributions WHERE referral_code_id IN (SELECT id FROM cutover_target_codes)`);
  await client.query(`CREATE TEMP TABLE cutover_target_referrals ON COMMIT DROP AS
    SELECT id FROM referrals
    WHERE referrer_user_id IN (SELECT id FROM cutover_target_users)
       OR attribution_id IN (SELECT id FROM cutover_target_attributions)`);
  await client.query(`CREATE TEMP TABLE cutover_target_admins ON COMMIT DROP AS
    SELECT id FROM admin_users WHERE email_hash=$1`, [demoAdminEmailHash]);

  await client.query("DELETE FROM referral_auth_sessions WHERE referral_user_id IN (SELECT id FROM cutover_target_users)");
  await client.query("DELETE FROM referral_auth_sessions WHERE admin_user_id IN (SELECT id FROM cutover_target_admins)");

  // These append-only tables contain only records proven to have been
  // produced by the review fixture. Trigger changes and deletes are atomic: any
  // failure rolls the transaction and trigger state back together.
  await client.query("ALTER TABLE reward_ledger DISABLE TRIGGER reward_ledger_immutable");
  await client.query("ALTER TABLE referral_events DISABLE TRIGGER referral_events_immutable");
  await client.query("ALTER TABLE admin_audit_log DISABLE TRIGGER admin_audit_log_immutable");
  await client.query("ALTER TABLE referral_attributions DISABLE TRIGGER referral_attributions_immutable");
  try {
    await client.query("DELETE FROM reward_ledger WHERE referral_user_id IN (SELECT id FROM cutover_target_users) OR referral_id IN (SELECT id FROM cutover_target_referrals)");
    await client.query("DELETE FROM referral_events WHERE referral_id IN (SELECT id FROM cutover_target_referrals)");
    await client.query(`DELETE FROM admin_audit_log
      WHERE admin_user_id IN (SELECT id FROM cutover_target_admins)
         OR request_id LIKE 'demo%'
         OR action LIKE 'DEMO_%'`);
    await client.query("DELETE FROM fraud_flags WHERE referral_id IN (SELECT id FROM cutover_target_referrals)");
    await client.query("DELETE FROM payout_requests WHERE referral_user_id IN (SELECT id FROM cutover_target_users)");
    await client.query("DELETE FROM payout_accounts WHERE referral_user_id IN (SELECT id FROM cutover_target_users)");
    await client.query("DELETE FROM referrals WHERE id IN (SELECT id FROM cutover_target_referrals)");
    await client.query("DELETE FROM referral_attributions WHERE id IN (SELECT id FROM cutover_target_attributions)");
    await client.query("DELETE FROM referral_codes WHERE id IN (SELECT id FROM cutover_target_codes)");
    await client.query("DELETE FROM referral_users WHERE id IN (SELECT id FROM cutover_target_users)");
    await client.query("DELETE FROM admin_users WHERE id IN (SELECT id FROM cutover_target_admins)");
  } finally {
    await client.query("ALTER TABLE reward_ledger ENABLE TRIGGER reward_ledger_immutable");
    await client.query("ALTER TABLE referral_events ENABLE TRIGGER referral_events_immutable");
    await client.query("ALTER TABLE admin_audit_log ENABLE TRIGGER admin_audit_log_immutable");
    await client.query("ALTER TABLE referral_attributions ENABLE TRIGGER referral_attributions_immutable");
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.REFERRAL_DATABASE_URL;
  if (!connectionString) throw new Error("REFERRAL_DATABASE_URL is required.");
  const apply = process.argv.includes("--apply");
  if (apply && process.env.PRODUCTION_CUTOVER_CONFIRM !== "REMOVE_CONFIRMED_SYNTHETIC_DATA") {
    throw new Error("Production cleanup confirmation is missing.");
  }
  const manifestPath = process.env.CUTOVER_MANIFEST_PATH;
  if (!manifestPath) throw new Error("CUTOVER_MANIFEST_PATH is required.");

  const pool = new Pool({ connectionString, max: 1, ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const before = await counts(client);
    const ids = await targetIds(client);
    const realBefore = Number((await rows<{ count: string }>(client, `SELECT count(*)::text AS count FROM referral_users
      WHERE NOT (patient_reference=ANY($1::text[]) OR patient_reference LIKE 'test-step113-%')`, [exactPatientReferences]))[0]?.count ?? 0);
    await writeFile(manifestPath, `${JSON.stringify({
      createdAt: new Date().toISOString(),
      mode: apply ? "apply" : "dry-run",
      classification: { exactPatientReferences, prefix: "test-step113-%", demoAdmin: "known SHA-256 fixture identity" },
      counts: before,
      syntheticIds: ids,
      preservedReferralUsers: realBefore,
      excludedFromCleanup: ["webhook_events", "referral_handoff_nonces", "campaigns", "programme_settings", "ambiguous or potentially real records"],
    }, null, 2)}\n`, { mode: 0o600 });

    if (!apply) {
      await client.query("ROLLBACK");
      console.log("Cutover cleanup dry-run verified; no database changes retained.");
      return;
    }

    await deleteConfirmedSyntheticGraph(client);
    const after = await counts(client);
    if (Object.values(after).some((value) => value !== 0)) throw new Error("Confirmed synthetic rows remain; cleanup rolled back.");
    const realAfter = Number((await rows<{ count: string }>(client, `SELECT count(*)::text AS count FROM referral_users
      WHERE NOT (patient_reference=ANY($1::text[]) OR patient_reference LIKE 'test-step113-%')`, [exactPatientReferences]))[0]?.count ?? 0);
    if (realAfter !== realBefore) throw new Error("Preserved referral-user count changed; cleanup rolled back.");
    const founder = await rows<{ id: string }>(client, "SELECT id FROM admin_users ORDER BY created_at LIMIT 1");
    await client.query(`INSERT INTO admin_audit_log(admin_user_id,action,subject_type,request_id,before_data,after_data)
      VALUES ($1,'PRODUCTION_SYNTHETIC_CUTOVER_CLEANUP','system','production-cutover-2026-10-04',$2::jsonb,$3::jsonb)`,
      [founder[0]?.id ?? null, JSON.stringify(before), JSON.stringify(after)]);
    await client.query("COMMIT");
    console.log("Confirmed synthetic production graph removed; ambiguous and potentially real records preserved.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNCLASSIFIED";
  console.error(`Production cutover cleanup failed (${code}); transaction rolled back and sensitive diagnostics were redacted.`);
  process.exitCode = 1;
});
