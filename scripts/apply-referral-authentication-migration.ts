import { resolve } from "node:path";
import { runPsql } from "./referral-database";

async function main(): Promise<void> {
  await runPsql(["-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", resolve("db/migrations/0003_phase11_authentication_foundation.sql")]);
  console.log("Applied 0003_phase11_authentication_foundation.sql.");
}

void main();
