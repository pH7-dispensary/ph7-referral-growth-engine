import "server-only";
import { getPostgresExecutor, referralDatabaseConfigured } from "@/lib/persistence/node-postgres";
import { PostgresOperationalRepository } from "@/lib/persistence/operations-postgres";
export function getPostgresRuntime(): PostgresOperationalRepository | null { return referralDatabaseConfigured() ? new PostgresOperationalRepository(getPostgresExecutor()) : null; }
