import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { SqlExecutor, SqlResult } from "@/lib/persistence/postgres";

type PgQueryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

class PgExecutor implements SqlExecutor {
  constructor(private readonly queryable: PgQueryable, private readonly pool?: Pool) {}

  async query<Row>(statement: string, parameters: readonly unknown[] = []): Promise<SqlResult<Row>> {
    const result = await this.queryable.query<QueryResultRow>(statement, [...parameters]);
    return { rows: result.rows as Row[] };
  }

  async transaction<T>(operation: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error("Nested PostgreSQL transactions are not supported by this executor.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await operation(new PgExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

const poolKey = "__ph7ReferralPostgresPool" as const;
type GlobalPool = typeof globalThis & { [poolKey]?: Pool };

export function referralDatabaseConfigured(): boolean {
  return Boolean(process.env.REFERRAL_DATABASE_URL);
}

export function getPostgresExecutor(): SqlExecutor {
  const connectionString = process.env.REFERRAL_DATABASE_URL;
  if (!connectionString) throw new Error("REFERRAL_DATABASE_URL is required for PostgreSQL persistence.");
  const store = globalThis as GlobalPool;
  store[poolKey] ??= new Pool({ connectionString, max: 4, ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined });
  return new PgExecutor(store[poolKey], store[poolKey]);
}

/** Tests use this to prove records survive a fresh repository/pool composition. */
export async function resetPostgresExecutorForTest(): Promise<void> {
  const store = globalThis as GlobalPool;
  await store[poolKey]?.end();
  delete store[poolKey];
}
