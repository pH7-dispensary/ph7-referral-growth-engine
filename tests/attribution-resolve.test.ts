import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleAttributionResolve, type AttributionResolveDependencies } from "@/app/api/attributions/resolve/route";
import { webhookSignaturePayload } from "@/lib/webhook/signature";

const secret = "synthetic-webhook-secret";
const attributionId = "attr_0123456789abcdef0123456789abcdef";
const patientReference = "pat_eu_42";

function signedRequest(payload: unknown, options: { secret?: string; timestamp?: string; body?: string } = {}): Request {
  const body = options.body ?? JSON.stringify(payload);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const signature = createHmac("sha256", options.secret ?? secret).update(webhookSignaturePayload(timestamp, body)).digest("hex");
  return new Request("https://refer.ph7.health/api/attributions/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ph7-timestamp": timestamp, "x-ph7-signature": signature },
    body,
  });
}

const ok = { status: "ok" as const, friendIncentiveMinor: 1000, currency: "EUR" as const };

function deps(resolve: AttributionResolveDependencies["resolve"] = vi.fn(async () => ok)): AttributionResolveDependencies {
  return { secret, toleranceSeconds: 300, resolve };
}

describe("POST /api/attributions/resolve", () => {
  it("returns the attribution's snapshotted friend incentive", async () => {
    const resolve = vi.fn(async () => ok);
    const response = await handleAttributionResolve(signedRequest({ attribution_id: attributionId, patient_reference: patientReference }), deps(resolve));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ attribution_id: attributionId, friend_incentive_minor: 1000, currency: "EUR" });
    expect(resolve).toHaveBeenCalledWith(attributionId, patientReference);
  });

  it("rejects a wrong signature or stale timestamp before touching the database", async () => {
    const resolve = vi.fn(async () => ok);
    const payload = { attribution_id: attributionId, patient_reference: patientReference };

    expect((await handleAttributionResolve(signedRequest(payload, { secret: "wrong" }), deps(resolve))).status).toBe(401);
    expect((await handleAttributionResolve(signedRequest(payload, { timestamp: new Date(Date.now() - 600_000).toISOString() }), deps(resolve))).status).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects malformed or extra fields", async () => {
    for (const payload of [
      { attribution_id: "attr_nothex", patient_reference: patientReference },
      { attribution_id: attributionId, patient_reference: "42" },
      { attribution_id: attributionId, patient_reference: patientReference, friend_incentive_minor: 99999 },
    ]) {
      expect((await handleAttributionResolve(signedRequest(payload), deps())).status).toBe(400);
    }
    expect((await handleAttributionResolve(signedRequest(null, { body: "not json" }), deps())).status).toBe(400);
  });

  it("maps unknown attributions to 404 and self-referrals to 409", async () => {
    const payload = { attribution_id: attributionId, patient_reference: patientReference };
    expect((await handleAttributionResolve(signedRequest(payload), deps(vi.fn(async () => ({ status: "unknown" as const }))))).status).toBe(404);
    expect((await handleAttributionResolve(signedRequest(payload), deps(vi.fn(async () => ({ status: "self_referral" as const }))))).status).toBe(409);
  });

  it("is unavailable without a database or secret, and on database errors", async () => {
    const payload = { attribution_id: attributionId, patient_reference: patientReference };
    expect((await handleAttributionResolve(signedRequest(payload), { secret, toleranceSeconds: 300, resolve: null })).status).toBe(503);
    expect((await handleAttributionResolve(signedRequest(payload), { secret: undefined, toleranceSeconds: 300, resolve: vi.fn(async () => ok) })).status).toBe(503);
    expect((await handleAttributionResolve(signedRequest(payload), deps(vi.fn(async () => { throw new Error("db down"); })))).status).toBe(503);
  });
});
