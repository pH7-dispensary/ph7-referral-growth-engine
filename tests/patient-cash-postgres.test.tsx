import { it } from "vitest";
import { resetPostgresExecutorForTest } from "@/lib/persistence/node-postgres";

// Opt-in: uses only the harness's fixed disposable loopback database, never dotenv.
it.skipIf(process.env.PH7_LOCAL_CASH_INTEGRATION !== "true")("verifies PostgreSQL cash economics, rendered UI, safe payouts, restarts and concurrency", async () => {
  try {
    const { testPatientCashIntegration } = await import("@/scripts/test-patient-cash");
    await testPatientCashIntegration();
  } finally { await resetPostgresExecutorForTest(); }
}, 30_000);
