import { describe, expect, it } from "vitest";
import { captureEconomicsSnapshot } from "@/lib/domain/economics";
import { InvalidTransitionError } from "@/lib/domain/errors";
import { EventIngestionService } from "@/lib/domain/services/event-ingestion";
import { LedgerService } from "@/lib/domain/services/ledger";
import { QualificationService } from "@/lib/domain/services/qualification";
import { ReferralLifecycleService } from "@/lib/domain/services/referral-lifecycle";
import type { Referral } from "@/lib/domain/types";
import { InMemoryReferralDatabase } from "@/tests/helpers/in-memory-repository";

const economics = () => captureEconomicsSnapshot({
  campaignId: "campaign-1", campaignVersion: 1, programmeSettingsVersion: 1,
  friendIncentiveMinor: 1000, referrerRewardMinor: 1000, currency: "EUR",
  qualificationEvent: "consultation.paid", holdingPeriodDays: 14, rewardCapMinor: null,
});

function referral(status: Referral["status"] = "ATTRIBUTED"): Referral {
  const now = new Date();
  return { id: "referral-1", referrerUserId: "user-1", attributionId: "attribution-1", economics: economics(), status, statusBeforeFraudReview: null, createdAt: now, updatedAt: now };
}

describe("controlled referral lifecycle", () => {
  it("accepts the primary state path and records each server-side event", async () => {
    const database = new InMemoryReferralDatabase();
    database.referrals.set("referral-1", referral());
    const service = new ReferralLifecycleService(database);
    for (const [index, status] of (["REGISTERED", "BOOKED", "PAID"] as const).entries()) {
      await service.transition({ referralId: "referral-1", toStatus: status, source: "SYSTEM", idempotencyKey: `transition-${index}` });
    }
    expect(database.referrals.get("referral-1")?.status).toBe("PAID");
    expect(database.events).toHaveLength(3);
  });

  it("rejects invalid and client-style state jumps", async () => {
    const database = new InMemoryReferralDatabase();
    database.referrals.set("referral-1", referral());
    const service = new ReferralLifecycleService(database);
    await expect(service.transition({ referralId: "referral-1", toStatus: "PAID_OUT", source: "SYSTEM", idempotencyKey: "bad-jump" }))
      .rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("allows fraud review only to restore its remembered state or reject", async () => {
    const database = new InMemoryReferralDatabase();
    database.referrals.set("referral-1", referral("PAID"));
    const service = new ReferralLifecycleService(database);
    await service.transition({ referralId: "referral-1", toStatus: "FRAUD_REVIEW", source: "SYSTEM", idempotencyKey: "flag" });
    await expect(service.transition({ referralId: "referral-1", toStatus: "BOOKED", source: "MANUAL", idempotencyKey: "wrong-resolution" }))
      .rejects.toMatchObject({ code: "INVALID_FRAUD_RESOLUTION" });
    await service.transition({ referralId: "referral-1", toStatus: "PAID", source: "MANUAL", idempotencyKey: "restore" });
    expect(database.referrals.get("referral-1")?.status).toBe("PAID");
  });
});

describe("snapshots and idempotency", () => {
  it("makes historical economics immutable when future offers change", () => {
    const historical = economics();
    const future = captureEconomicsSnapshot({ ...historical, campaignVersion: 2, programmeSettingsVersion: 2, referrerRewardMinor: 2000 });
    expect(historical.referrerRewardMinor).toBe(1000);
    expect(future.referrerRewardMinor).toBe(2000);
    expect(() => { (historical as { referrerRewardMinor: number }).referrerRewardMinor = 2000; }).toThrow(TypeError);
  });

  it("accepts a duplicate lifecycle message exactly once even when concurrent", async () => {
    const database = new InMemoryReferralDatabase();
    database.referrals.set("referral-1", referral());
    const service = new ReferralLifecycleService(database);
    await Promise.all(Array.from({ length: 8 }, () => service.transition({ referralId: "referral-1", toStatus: "REGISTERED", source: "WEBHOOK", idempotencyKey: "external-event-1" })));
    expect(database.events).toHaveLength(1);
    expect(database.referrals.get("referral-1")?.status).toBe("REGISTERED");
  });

  it("posts duplicate financial events exactly once under concurrency", async () => {
    const database = new InMemoryReferralDatabase();
    const ledger = new LedgerService(database);
    const entries = await Promise.all(Array.from({ length: 8 }, () => ledger.post({ referralId: "referral-1", type: "CREDIT", amountMinor: 1000, idempotencyKey: "payment-1" })));
    expect(database.ledger).toHaveLength(1);
    expect(new Set(entries.map((entry) => entry.id))).toHaveLength(1);
  });

  it("uses one shared qualification service for the lifecycle event and reward credit", async () => {
    const database = new InMemoryReferralDatabase();
    database.referrals.set("referral-1", referral("PAID"));
    const lifecycle = new ReferralLifecycleService(database);
    const ledger = new LedgerService(database);
    const qualification = new QualificationService(database, lifecycle, ledger);
    await Promise.all([qualification.qualifyReferral({ referralId: "referral-1", source: "WEBHOOK", eventKey: "consultation-1" }), qualification.qualifyReferral({ referralId: "referral-1", source: "MANUAL", eventKey: "consultation-1" })]);
    expect(database.referrals.get("referral-1")?.status).toBe("QUALIFIED");
    expect(database.events).toHaveLength(1);
    expect(database.ledger).toHaveLength(1);
  });

  it("claims duplicate external event IDs before executing an event handler", async () => {
    const database = new InMemoryReferralDatabase();
    const ingestion = new EventIngestionService(database);
    let calls = 0;
    const results = await Promise.all(Array.from({ length: 6 }, () => ingestion.process({ eventId: "evt-1", eventType: "consultation.paid" }, async () => { calls += 1; return "processed"; })));
    expect(calls).toBe(1);
    expect(database.webhooks).toHaveLength(1);
    expect(results.filter((result) => result.duplicate)).toHaveLength(5);
  });
});
