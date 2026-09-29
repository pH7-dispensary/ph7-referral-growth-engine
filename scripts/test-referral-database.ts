import { resolve } from "node:path";
import { runPsql } from "./referral-database";

async function main(): Promise<void> {
  await runPsql(["-v", "ON_ERROR_STOP=1", "-f", resolve("scripts/postgres-integration.sql")]);
  console.log("PostgreSQL integration tests passed; synthetic fixtures were rolled back.");
}

void main();
