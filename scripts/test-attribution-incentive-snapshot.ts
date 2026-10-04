/**
 * Proves the friend incentive returned to pH7 is the attribution SNAPSHOT, not
 * the current campaign: €10 attribution stays €10 after the campaign moves to
 * €15/€20, a new attribution gets €15, a referrer resolving their own link is
 * rejected, and unknown ids are unknown. Runs against a throwaway database
 * named by SNAPSHOT_TEST_DATABASE_URL (never REFERRAL_DATABASE_URL).
 */
import { Pool, type QueryResultRow } from "pg";
import { DatabaseAttributionService } from "@/lib/funnel/database-attribution";
import { PostgresOperationalRepository } from "@/lib/persistence/operations-postgres";
import type { SqlExecutor, SqlResult } from "@/lib/persistence/postgres";

const url = process.env.SNAPSHOT_TEST_DATABASE_URL;
if (!url) throw new Error("SNAPSHOT_TEST_DATABASE_URL is required (a throwaway database).");
const pool = new Pool({ connectionString: url });

const sql: SqlExecutor = {
  async query<T>(statement: string, parameters: readonly unknown[] = []): Promise<SqlResult<T>> {
    const result = await pool.query<QueryResultRow>(statement, [...parameters]);
    return { rows: result.rows as T[] };
  },
  async transaction<T>(operation: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    const tx: SqlExecutor = {
      async query<R>(statement: string, parameters: readonly unknown[] = []) {
        return { rows: (await client.query<QueryResultRow>(statement, [...parameters])).rows as R[] };
      },
      transaction: (inner) => inner(tx),
    };
    try {
      await client.query("BEGIN");
      const value = await operation(tx);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};

function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}`);
  if (!pass) process.exitCode = 1;
}

async function main(): Promise<void> {
  const operations = new PostgresOperationalRepository(sql);
  const funnel = new DatabaseAttributionService(sql);

  const referrer = await sql.query<{ id: string }>("INSERT INTO referral_users (patient_reference) VALUES ('pat_eu_900001') RETURNING id");
  await sql.query("INSERT INTO referral_codes (referral_user_id, code) VALUES ($1, 'SNAPTEST1')", [referrer.rows[0].id]);

  await operations.setCampaign({ friendIncentiveMinor: 1000, referrerRewardMinor: 1000, active: true });
  const old = await funnel.createOrResolveAttribution({ code: "SNAPTEST1", journeyId: "friend-a" });

  await operations.setCampaign({ friendIncentiveMinor: 1500, referrerRewardMinor: 2000, active: true });
  const fresh = await funnel.createOrResolveAttribution({ code: "SNAPTEST1", journeyId: "friend-b" });

  check("A/B  €10 attribution after campaign → €15/€20", await operations.resolveAttributionIncentive(old.attribution.attributionId, "pat_eu_1"), { status: "ok", friendIncentiveMinor: 1000, currency: "EUR" });
  check("C    new attribution", await operations.resolveAttributionIncentive(fresh.attribution.attributionId, "pat_eu_2"), { status: "ok", friendIncentiveMinor: 1500, currency: "EUR" });
  check("     referrer resolving own link", await operations.resolveAttributionIncentive(old.attribution.attributionId, "pat_eu_900001"), { status: "self_referral" });
  check("E    unknown attribution", await operations.resolveAttributionIncentive("attr_00000000000000000000000000000000", "pat_eu_1"), { status: "unknown" });
  check("     current campaign (for contrast)", Number((await operations.activeCampaign())?.friendIncentiveMinor), 1500);
}

main().finally(() => pool.end());
