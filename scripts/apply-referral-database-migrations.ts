import { resolve } from "node:path";
import { runPsql } from "./referral-database";

async function main(): Promise<void> {
  for (const migration of ["0001_phase2_referral_engine.sql", "0002_phase11_database_readiness.sql"]) {
    await runPsql(["-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", resolve("db/migrations", migration)]);
    console.log(`Applied ${migration}.`);
  }
}

void main();
