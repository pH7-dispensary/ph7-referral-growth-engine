import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain/errors";
import { LocalReferralEngine } from "@/lib/local/engine";
import { behaviouralEvents } from "@/lib/local/analytics";
import { developmentAdminEnabled } from "@/lib/local/admin-access";

const secret = "test-webhook-secret";
function signed(engine: LocalReferralEngine, payload: object) { const body = JSON.stringify(payload); return { body, signature: createHmac("sha256", secret).update(body).digest("hex"), engine }; }
function paidPayload(eventId: string, attributionId = `attr_${eventId}`) { return { event_id: eventId, type: "consultation.paid", patient_reference: "synthetic-friend", consultation_reference: `consult-${eventId}`, attribution_id: attributionId, timestamp: "2026-09-23T12:00:00.000Z" }; }

describe("local founder, ledger, and payout invariants", () => {
  it("keeps a €10 historical snapshot after the programme moves to €20", async () => {
    const engine = new LocalReferralEngine(); const referral = engine.createReferral("attr-history");
    await engine.setEconomics({ friendIncentiveMinor: 2000, referrerRewardMinor: 2000, active: true });
    expect(referral.economics.referrerRewardMinor).toBe(1000); expect(engine.campaign.referrerRewardMinor).toBe(2000);
  });
  it("uses one idempotent path for manual qualification and creates one credit", async () => {
    const engine = new LocalReferralEngine(); const referral = [...engine.referrals.values()].find((item) => item.status === "PAID")!;
    await Promise.all([engine.qualify(referral.id, "same-event", "MANUAL"), engine.qualify(referral.id, "same-event", "MANUAL")]);
    expect(engine.ledger.filter((entry) => entry.idempotencyKey === "credit:same-event")).toHaveLength(1); expect(referral.status).toBe("QUALIFIED");
  });
  it("posts a payout debit once and derives its balance from immutable ledger entries", async () => {
    const engine = new LocalReferralEngine(); const before = engine.balance(); const request = await engine.requestPayout("synthetic-ava", 500, "withdraw-1");
    await Promise.all([engine.markPayoutPaid(request.id, request.id), engine.markPayoutPaid(request.id, request.id)]);
    expect(engine.balance()).toBe(before - 500); expect(engine.ledger.filter((entry) => entry.type === "PAYOUT")).toHaveLength(1);
  });
  it("blocks automatic qualification while a deterministic fraud flag is open", async () => {
    const engine = new LocalReferralEngine(); const referral = [...engine.referrals.values()].find((item) => item.status === "PAID")!;
    await engine.flag(referral.id, "SELF_REFERRAL"); await expect(engine.qualify(referral.id, "blocked", "MANUAL")).rejects.toMatchObject({ code: "FRAUD_REVIEW" });
    expect(referral.status).toBe("FRAUD_REVIEW");
  });
  it("records all supported behavioural events locally without a GA4 dependency", () => {
    const engine = new LocalReferralEngine(); behaviouralEvents.forEach((name) => engine.recordAnalytics(name));
    expect(engine.analytics.map((event) => event.name)).toEqual(behaviouralEvents);
  });
  it("keeps founder access development-only", () => {
    expect(developmentAdminEnabled("development")).toBe(true); expect(developmentAdminEnabled("production")).toBe(false);
  });
});

describe("local signed webhook boundary", () => {
  it("accepts one valid paid event and ignores duplicates", async () => {
    const engine = new LocalReferralEngine(); const { body, signature } = signed(engine, paidPayload("evt-paid-1"));
    const first = await engine.processWebhook(body, signature, secret); const second = await engine.processWebhook(body, signature, secret);
    expect(first.duplicate).toBe(false); expect(second.duplicate).toBe(true); expect(engine.ledger.filter((entry) => entry.idempotencyKey === "credit:evt-paid-1")).toHaveLength(1);
  });
  it("uses the same qualification result for a paid webhook and manual qualification", async () => {
    const webhookEngine = new LocalReferralEngine(); const manualEngine = new LocalReferralEngine(); const payload = paidPayload("evt-equivalent", "attr-equivalent"); const { body, signature } = signed(webhookEngine, payload);
    await webhookEngine.processWebhook(body, signature, secret); const manual = manualEngine.createReferral("attr-manual"); await manualEngine.transition(manual.id, "REGISTERED"); await manualEngine.transition(manual.id, "BOOKED"); await manualEngine.transition(manual.id, "PAID"); await manualEngine.qualify(manual.id, "evt-equivalent", "MANUAL");
    expect([...webhookEngine.referrals.values()].find((r) => r.attributionId === "attr-equivalent")?.status).toBe("QUALIFIED"); expect(manual.status).toBe("QUALIFIED");
  });
  it("rejects bad signatures without corrupting webhook or ledger state", async () => {
    const engine = new LocalReferralEngine(); const body = JSON.stringify(paidPayload("evt-bad"));
    await expect(engine.processWebhook(body, "bad", secret)).rejects.toBeInstanceOf(DomainError); expect(engine.webhookIds.has("evt-bad")).toBe(false); expect(engine.ledger).toHaveLength(1);
  });
  it("rejects malformed webhook payloads without claiming their event id", async () => {
    const engine = new LocalReferralEngine(); const body = "{not-json"; const signature = createHmac("sha256", secret).update(body).digest("hex");
    await expect(engine.processWebhook(body, signature, secret)).rejects.toThrow(); expect(engine.webhookIds.size).toBe(0);
  });
  it("reverses a qualified reward exactly once on refund", async () => {
    const engine = new LocalReferralEngine(); const paid = paidPayload("evt-refund", "attr-refund"); let signedRequest = signed(engine, paid); await engine.processWebhook(signedRequest.body, signedRequest.signature, secret);
    const refund = { ...paid, event_id: "evt-refund-2", type: "consultation.refunded" as const }; signedRequest = signed(engine, refund); await engine.processWebhook(signedRequest.body, signedRequest.signature, secret); await engine.processWebhook(signedRequest.body, signedRequest.signature, secret);
    expect(engine.ledger.filter((entry) => entry.type === "REVERSAL")).toHaveLength(1); expect([...engine.referrals.values()].find((r) => r.attributionId === "attr-refund")?.status).toBe("REFUNDED");
  });
});
