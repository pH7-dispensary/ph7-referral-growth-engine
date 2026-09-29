import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { DatabaseAttributionService } from "@/lib/funnel/database-attribution";
import { getPostgresExecutor, resetPostgresExecutorForTest } from "@/lib/persistence/node-postgres";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd());

const token = randomUUID().replaceAll("-", "");
const userReference = `test-step113-${token}`;
const code = `R${token.slice(0, 11).toUpperCase()}`;

async function main(): Promise<void> {
  let userId = ""; let codeId = ""; let attributionId = "";
  try {
    let sql = getPostgresExecutor();
    userId = (await sql.query<{ id: string }>("INSERT INTO referral_users (patient_reference, email_hash) VALUES ($1, $2) RETURNING id", [userReference, "test-hash"])).rows[0]!.id;
    codeId = (await sql.query<{ id: string }>("INSERT INTO referral_codes (referral_user_id, code) VALUES ($1, $2) RETURNING id", [userId, code])).rows[0]!.id;
    const activeOffer = await sql.query<{ id: string }>("SELECT c.id FROM campaigns c WHERE c.is_active AND EXISTS (SELECT 1 FROM programme_settings WHERE programme_enabled) LIMIT 1");
    if (!activeOffer.rows[0]) throw new Error("Runtime persistence test requires the dedicated database's existing synthetic active offer.");
    const created = await new DatabaseAttributionService(sql).createOrResolveAttribution({ code, journeyId: `synthetic-${token}` });
    attributionId = created.attribution.attributionId;
    if (!created.created) throw new Error("Synthetic attribution was not created.");

    await resetPostgresExecutorForTest();
    sql = getPostgresExecutor();
    const restored = await new DatabaseAttributionService(sql).findAttribution(attributionId);
    if (!restored || restored.attributionId !== attributionId) throw new Error("Persisted attribution was not retrievable after repository reinitialisation.");
    console.log("PostgreSQL runtime persistence/reinitialisation test passed.");
  } finally {
    const sql = getPostgresExecutor();
    await sql.transaction(async (transaction) => {
      if (attributionId) {
        await transaction.query("LOCK TABLE referral_attributions IN ACCESS EXCLUSIVE MODE");
        await transaction.query("ALTER TABLE referral_attributions DISABLE TRIGGER referral_attributions_immutable");
        await transaction.query("DELETE FROM referral_attributions WHERE public_id = $1", [attributionId]);
        await transaction.query("ALTER TABLE referral_attributions ENABLE TRIGGER referral_attributions_immutable");
      }
      if (codeId) await transaction.query("DELETE FROM referral_codes WHERE id = $1", [codeId]);
      if (userId) await transaction.query("DELETE FROM referral_users WHERE id = $1", [userId]);
    });
    await resetPostgresExecutorForTest();
  }
}

void main();
