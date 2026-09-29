import { describe, expect, it } from "vitest";
import { PostgresAttributionRepository, type SqlExecutor } from "@/lib/persistence/postgres";

const input = {
  referralCodeId: "11111111-1111-4111-8111-111111111111", campaignId: "22222222-2222-4222-8222-222222222222",
  publicId: "attr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", journeyContextHash: "sha256:context",
  campaignVersion: 1, programmeSettingsVersion: 1, friendIncentiveMinor: 1000, referrerRewardMinor: 1000,
  currency: "EUR" as const, qualificationEvent: "consultation.paid", holdingPeriodDays: 14, rewardCapMinor: null,
};
const row = { id: "33333333-3333-4333-8333-333333333333", public_id: input.publicId, journey_context_hash: input.journeyContextHash,
  campaign_version: 1, programme_settings_version: 1, friend_incentive_minor: 1000, referrer_reward_minor: 1000,
  currency: "EUR" as const, qualification_event: "consultation.paid", holding_period_days: 14, reward_cap_minor: null,
  created_at: "2026-09-23T00:00:00.000Z" };

describe("PostgresAttributionRepository", () => {
  it("uses parameterized SQL and returns the newly inserted immutable record", async () => {
    const calls: Array<{ statement: string; parameters?: readonly unknown[] }> = [];
    const sql: SqlExecutor = {
      async query<Row>(statement: string, parameters?: readonly unknown[]) {
        calls.push({ statement, parameters });
        return { rows: [row as unknown as Row] };
      },
      async transaction(operation) { return operation(this); },
    };
    const result = await new PostgresAttributionRepository(sql).createOrResolve(input);
    expect(result.created).toBe(true);
    expect(result.attribution.publicId).toBe(input.publicId);
    expect(calls[0]?.statement).toContain("ON CONFLICT (journey_context_hash) DO NOTHING");
    expect(calls[0]?.statement).not.toContain(input.publicId);
    expect(calls[0]?.parameters).toContain(input.publicId);
  });

  it("resolves the existing record after a concurrent idempotency conflict", async () => {
    let queryNumber = 0;
    const sql: SqlExecutor = {
      async query<Row>() {
        queryNumber += 1;
        return { rows: queryNumber === 1 ? [] : [row as unknown as Row] };
      },
      async transaction(operation) { return operation(this); },
    };
    const result = await new PostgresAttributionRepository(sql).createOrResolve(input);
    expect(result).toMatchObject({ created: false, attribution: { publicId: input.publicId } });
  });
});
