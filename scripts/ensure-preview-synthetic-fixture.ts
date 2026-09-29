import { createRequire } from "node:module";
import { getPostgresExecutor, resetPostgresExecutorForTest } from "@/lib/persistence/node-postgres";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd());

/**
 * Deliberately non-personal preview data. It makes one safe invitation available
 * for the isolated staging deployment without changing an existing offer.
 */
async function main(): Promise<void> {
  const sql = getPostgresExecutor();
  await sql.transaction(async (transaction) => {
    const user = await transaction.query<{ id: string }>(
      "INSERT INTO referral_users (patient_reference,email_hash) VALUES ('preview-synthetic-referrer-v1',$1) ON CONFLICT (patient_reference) DO UPDATE SET email_hash=EXCLUDED.email_hash RETURNING id",
      ["f".repeat(64)],
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error("Preview synthetic referral user could not be prepared.");
    await transaction.query(
      "INSERT INTO referral_codes (referral_user_id,code,is_active) VALUES ($1,'PREVIEW11',true) ON CONFLICT (code) DO UPDATE SET referral_user_id=EXCLUDED.referral_user_id,is_active=true,revoked_at=NULL",
      [userId],
    );

    await transaction.query("LOCK TABLE campaigns IN SHARE ROW EXCLUSIVE MODE");
    const activeCampaign = await transaction.query<{ id: string }>("SELECT id FROM campaigns WHERE is_active=true LIMIT 1 FOR UPDATE");
    if (!activeCampaign.rows[0]) {
      await transaction.query(
        "INSERT INTO campaigns (version,name,is_active,friend_incentive_minor,referrer_reward_minor,holding_period_days) VALUES ((SELECT COALESCE(MAX(version),0)+1 FROM campaigns),'Preview synthetic referral offer',true,1000,1000,0)",
      );
    }
    const activeSettings = await transaction.query<{ id: string }>("SELECT id FROM programme_settings WHERE programme_enabled=true LIMIT 1 FOR UPDATE");
    if (!activeSettings.rows[0]) {
      await transaction.query("INSERT INTO programme_settings (version,programme_enabled,minimum_withdrawal_minor) VALUES ((SELECT COALESCE(MAX(version),0)+1 FROM programme_settings),true,1000)");
    }
  });
  await resetPostgresExecutorForTest();
  console.log("Preview synthetic referral fixture is ready.");
}

void main();
