import { createRequire } from "node:module";
import { getPostgresExecutor, resetPostgresExecutorForTest } from "@/lib/persistence/node-postgres";
import { PostgresOperationalRepository } from "@/lib/persistence/operations-postgres";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd());

const requestId = "production-cutover-campaign-2026-10-04";

async function main(): Promise<void> {
  if (process.env.PRODUCTION_CUTOVER_CONFIRM !== "ACTIVATE_REAL_CAMPAIGN") throw new Error("Production campaign confirmation is missing.");
  const sql = getPostgresExecutor();
  const existing = await sql.query<{ id: string }>("SELECT id FROM admin_audit_log WHERE request_id=$1 LIMIT 1", [requestId]);
  if (existing.rows[0]) {
    console.log("Production campaign was already activated; no change made.");
    return;
  }
  const active = await sql.query<{ friend_incentive_minor: string; referrer_reward_minor: string; holding_period_days: number }>(
    "SELECT friend_incentive_minor::text,referrer_reward_minor::text,holding_period_days FROM campaigns WHERE is_active=true FOR UPDATE",
  );
  const current = active.rows[0];
  if (!current) throw new Error("An active campaign is required before cutover.");
  const actor = await sql.query<{ id: string }>("SELECT id FROM admin_users WHERE role='FOUNDER' ORDER BY created_at LIMIT 1");
  if (!actor.rows[0]) throw new Error("A founder admin is required before cutover.");
  const campaign = await new PostgresOperationalRepository(sql).setCampaign({
    friendIncentiveMinor: Number(current.friend_incentive_minor),
    referrerRewardMinor: Number(current.referrer_reward_minor),
    holdingPeriodDays: current.holding_period_days,
    active: true,
  }, { adminUserId: actor.rows[0].id, requestId });
  console.log(`Production campaign version ${campaign.version} activated from the audited live economics.`);
}

void main()
  .catch(() => {
    console.error("Production campaign activation failed; sensitive diagnostics were redacted.");
    process.exitCode = 1;
  })
  .finally(resetPostgresExecutorForTest);
