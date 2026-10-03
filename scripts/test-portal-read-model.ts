import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { getPostgresExecutor, resetPostgresExecutorForTest } from "@/lib/persistence/node-postgres";
import { getPostgresPatientPortalData } from "@/lib/portal/postgres-data";
import type { SqlExecutor } from "@/lib/persistence/postgres";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
let stage = "target-identity";

/** Synthetic fixtures exist only in a transaction that always rolls back.
 * Never disables triggers, updates settings, or changes existing records.
 */
async function main() {
  const configured = process.env.REFERRAL_DATABASE_URL;
  assert(configured, "Dedicated referral database configuration is required.");
  const target = new URL(configured);
  const dedicatedProject = "jllhxrjgvycctjjfridb";
  const isolatedLocal = process.argv.includes("--isolated-local") && target.hostname === "127.0.0.1"
    && target.port === "55473" && target.pathname === "/ph7_release_test";
  assert(isolatedLocal || target.hostname === `db.${dedicatedProject}.supabase.co` || (target.hostname.endsWith(".pooler.supabase.com") && target.username.endsWith(`.${dedicatedProject}`)), "Unexpected database target; test stopped.");
  const sql = getPostgresExecutor();
  const marker = `synthetic-ui-read-${randomUUID()}`;
  const rollback = new Error("SYNTHETIC_REVIEW_ROLLBACK");
  let verified = false;
  try {
    stage = "transaction-connect";
    await sql.transaction(async (tx) => {
      stage = "programme-read";
      const offer = (await tx.query<{ id: string; version: number; friend_incentive_minor: string; referrer_reward_minor: string; holding_period_days: number }>("SELECT id,version,friend_incentive_minor,referrer_reward_minor,holding_period_days FROM campaigns WHERE is_active LIMIT 1")).rows[0];
      const settings = (await tx.query<{ version: number }>("SELECT version FROM programme_settings WHERE programme_enabled ORDER BY version DESC LIMIT 1")).rows[0];
      assert(offer && settings, "Active referral programme is required.");
      stage = "synthetic-user-code";
      const userId = (await tx.query<{ id: string }>("INSERT INTO referral_users(patient_reference,email_hash) VALUES ($1,'synthetic-ui-hash') RETURNING id", [marker])).rows[0]!.id;
      const code = `UI${randomUUID().replaceAll("-", "").slice(0,10).toUpperCase()}`;
      const codeId = (await tx.query<{ id: string }>("INSERT INTO referral_codes(referral_user_id,code) VALUES ($1,$2) RETURNING id",[userId,code])).rows[0]!.id;
      for (const [index,status,amount,creditStatus] of [[0,"PAYABLE",1000,"EFFECTIVE"],[1,"QUALIFIED",500,"PENDING"],[2,"REFUNDED",1000,"EFFECTIVE"]] as const) {
        stage = "synthetic-attribution";
        const publicId = `attr_${randomUUID().replaceAll("-","")}`;
        const attributionId = (await tx.query<{id:string}>(`INSERT INTO referral_attributions(referral_code_id,campaign_id,campaign_version,programme_settings_version,friend_incentive_minor,referrer_reward_minor,currency,qualification_event,holding_period_days,public_id,journey_context_hash)
          VALUES ($1,$2,$3,$4,750,1500,'EUR','consultation.paid',9,$5,$6) RETURNING id`,[codeId,offer.id,offer.version,settings.version,publicId,`${marker}:${index}`])).rows[0]!.id;
        stage = "synthetic-referral";
        const referralId = (await tx.query<{id:string}>(`INSERT INTO referrals(referrer_user_id,attribution_id,status,campaign_id,campaign_version,programme_settings_version,friend_incentive_minor,referrer_reward_minor,currency,qualification_event,holding_period_days)
          VALUES ($1,$2,$3,$4,$5,$6,750,1500,'EUR','consultation.paid',9) RETURNING id`,[userId,attributionId,status,offer.id,offer.version,settings.version])).rows[0]!.id;
        stage = "synthetic-ledger";
        await tx.query("INSERT INTO reward_ledger(referral_user_id,referral_id,type,amount_minor,status,idempotency_key,effective_at) VALUES ($1,$2,'CREDIT',$3,$4::ledger_entry_status,$5,CASE WHEN $4::ledger_entry_status='EFFECTIVE'::ledger_entry_status THEN now() ELSE NULL END)",[userId,referralId,amount,creditStatus,`${marker}:credit:${index}`]);
        if (status === "REFUNDED") await tx.query("INSERT INTO reward_ledger(referral_user_id,referral_id,type,amount_minor,status,idempotency_key,effective_at) VALUES ($1,$2,'REVERSAL',-1000,'EFFECTIVE',$3,now())",[userId,referralId,`${marker}:reversal`]);
      }
      stage = "portal-read";
      // The application normally fans reads out across its pool. This rollback-only
      // test uses one client, so serialise those reads for pg's single-client API.
      let reads = Promise.resolve();
      const readTx: SqlExecutor = {
        query<Row>(statement: string, parameters?: readonly unknown[]) {
          const result = reads.then(() => tx.query<Row>(statement,parameters));
          reads = result.then(() => undefined, () => undefined);
          return result;
        },
        transaction: (operation) => tx.transaction(operation),
      };
      const portal = await getPostgresPatientPortalData(readTx,userId);
      stage = "portal-assertions";
      assert(portal);
      assert.equal(portal.referralCode,code);
      assert.equal(portal.friendIncentiveMinor,Number(offer.friend_incentive_minor));
      assert.equal(portal.currentRewardMinor,Number(offer.referrer_reward_minor));
      assert.equal(portal.holdingPeriodDays,offer.holding_period_days);
      assert.equal(portal.availableBalanceMinor,1000);
      assert.equal(portal.pendingBalanceMinor,500);
      assert.equal(portal.totalEarnedMinor,2500);
      assert.equal(portal.referrals.length,3);
      assert(portal.referrals.every(ref => Object.isFrozen(ref.economics) && ref.economics.referrerRewardMinor === 1500));
      assert.equal(portal.referrals.find(ref => ref.status === "PAYABLE")?.ledgerCredit?.amountMinor,1000);
      assert.equal(portal.referrals.find(ref => ref.status === "QUALIFIED")?.ledgerCredit?.status,"PENDING");
      assert.equal(portal.referrals.find(ref => ref.status === "REFUNDED")?.hasLedgerReversal,true);
      assert.equal(await getPostgresPatientPortalData(readTx,randomUUID()),null);
      verified = true;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert(verified);
  stage = "rollback-verification";
  assert.equal((await sql.query("SELECT id FROM referral_users WHERE patient_reference=$1",[marker])).rows.length,0);
  console.log("PostgreSQL portal read-model integration passed; synthetic fixtures rolled back; existing records/settings/triggers unchanged.");
}

main().catch((error: unknown) => {
  const code = (error as {code?: string})?.code;
  console.error(`PostgreSQL portal read-model integration failed at ${stage}; classification=${code && /^[A-Z0-9_]+$/.test(code) ? code : "REDACTED"}.`);
  process.exitCode = 1;
}).finally(resetPostgresExecutorForTest);
