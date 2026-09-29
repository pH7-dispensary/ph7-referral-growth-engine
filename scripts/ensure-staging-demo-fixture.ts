import { createRequire } from "node:module";
import { ensureDemoFixture } from "@/lib/demo/data";
import { resetPostgresExecutorForTest } from "@/lib/persistence/node-postgres";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd());

process.env.APP_ENV = process.env.APP_ENV || "preview";
process.env.REFERRAL_DEMO_MODE = process.env.REFERRAL_DEMO_MODE || "true";

async function main(): Promise<void> {
  await ensureDemoFixture();
  await resetPostgresExecutorForTest();
  console.log("Staging demo fixture is ready.");
}

void main();
