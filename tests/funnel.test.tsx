import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FriendFunnel } from "@/components/funnel/friend-funnel";
import { LocalContinuation } from "@/components/funnel/local-continuation";
import { captureEconomicsSnapshot } from "@/lib/domain/economics";
import { FunnelAccessError, SyntheticAttributionService, isOpaqueAttributionId } from "@/lib/funnel/attribution";
import { buildPatientDestinationUrl } from "@/lib/funnel/patient-destination";

const service = () => new SyntheticAttributionService();
const now = new Date("2026-09-23T12:00:00.000Z");

describe("synthetic referred-friend offer resolution", () => {
  it("resolves a valid referral code server-side without revealing the referrer", () => {
    const result = service().resolveOffer("ph7-ava-72", now);
    expect(result).toEqual({ kind: "available", offer: expect.objectContaining({ code: "PH7-AVA-72", friendIncentiveMinor: 1000 }) });
    expect(JSON.stringify(result)).not.toContain("synthetic-ava");
  });

  it("handles malformed, invalid, inactive, expired, and unavailable offers safely", () => {
    const funnel = service();
    expect(funnel.resolveOffer("not a code", now)).toMatchObject({ kind: "unavailable", reason: "MALFORMED_CODE" });
    expect(funnel.resolveOffer("PH7-UNKNOWN-88", now)).toMatchObject({ kind: "unavailable", reason: "INVALID_CODE" });
    expect(funnel.resolveOffer("PH7-INACTIVE-99", now)).toMatchObject({ kind: "unavailable", reason: "INACTIVE_CODE" });
    expect(funnel.resolveOffer("PH7-EXPIRED-90", now)).toMatchObject({ kind: "unavailable", reason: "EXPIRED_CAMPAIGN" });
    expect(funnel.resolveOffer("PH7-OFFER-00", now)).toMatchObject({ kind: "unavailable", reason: "INACTIVE_OFFER" });
  });
});

describe("opaque attribution foundation", () => {
  it("creates a non-sequential opaque attribution ID and immutable economics snapshot", async () => {
    const result = await service().createOrResolveAttribution({ code: "PH7-AVA-72", journeyId: "00000000-0000-4000-8000-000000000001", now });
    expect(result.created).toBe(true);
    expect(isOpaqueAttributionId(result.attribution.attributionId)).toBe(true);
    expect(result.attribution.attributionId).not.toContain("AVA");
    expect(result.attribution.attributionId).not.toContain("synthetic");
    expect(result.attribution.economics.friendIncentiveMinor).toBe(1000);
    expect(result.attribution.economics.referrerRewardMinor).toBe(1000);
    expect(Object.isFrozen(result.attribution.economics)).toBe(true);
  });

  it("resolves duplicate and concurrent attribution attempts for one journey exactly once", async () => {
    const funnel = service();
    const attempts = await Promise.all(Array.from({ length: 8 }, () => funnel.createOrResolveAttribution({ code: "PH7-AVA-72", journeyId: "00000000-0000-4000-8000-000000000002", now })));
    expect(new Set(attempts.map(({ attribution }) => attribution.attributionId))).toHaveLength(1);
    expect(attempts.filter(({ created }) => created)).toHaveLength(1);
  });

  it("rejects unavailable offers before attribution is created", async () => {
    await expect(service().createOrResolveAttribution({ code: "PH7-EXPIRED-90", journeyId: "00000000-0000-4000-8000-000000000003", now }))
      .rejects.toEqual(expect.objectContaining({ name: "FunnelAccessError", reason: "EXPIRED_CAMPAIGN" } satisfies Partial<FunnelAccessError>));
  });

  it("keeps historical attribution economics even when a future offer value changes", async () => {
    const attribution = (await service().createOrResolveAttribution({ code: "PH7-AVA-72", journeyId: "00000000-0000-4000-8000-000000000004", now })).attribution;
    const changedFutureOffer = captureEconomicsSnapshot({ ...attribution.economics, campaignVersion: 2, programmeSettingsVersion: 2, friendIncentiveMinor: 2000, referrerRewardMinor: 2000 });
    expect(changedFutureOffer.friendIncentiveMinor).toBe(2000);
    expect(attribution.economics.friendIncentiveMinor).toBe(1000);
    expect(attribution.economics.referrerRewardMinor).toBe(1000);
  });
});

describe("friend-funnel presentation", () => {
  it("renders the friend incentive as pending contract configuration without a referrer identity", () => {
    const resolution = service().resolveOffer("PH7-AVA-72", now);
    if (resolution.kind !== "available") throw new Error("Expected synthetic offer");
    const markup = renderToStaticMarkup(<FriendFunnel offer={resolution.offer} />);
    expect(markup).toContain("€10 friend incentive");
    expect(markup).toContain("awaiting the approved pH7 checkout integration");
    expect(markup).toContain("Continue to pH7");
    expect(markup).not.toContain("synthetic-ava");
    expect(markup).not.toContain("ph7.health");
    expect(markup).not.toMatch(/https?:\/\//);
  });

  it("builds only the configured pH7 patient destination with an opaque attribution id", async () => {
    const attribution = (await service().createOrResolveAttribution({ code: "PH7-AVA-72", journeyId: "00000000-0000-4000-8000-000000000006", now })).attribution;
    const url = buildPatientDestinationUrl(attribution.attributionId, "https://patients.ph7.health");
    expect(url).toBe(`https://patients.ph7.health/?attribution_id=${encodeURIComponent(attribution.attributionId)}`);
    expect(() => buildPatientDestinationUrl(attribution.attributionId, "http://evil.test")).toThrow();
    expect(() => buildPatientDestinationUrl("not-opaque", "https://patients.ph7.health")).toThrow();
  });

  it("shows only an opaque ID in the safe local continuation", async () => {
    const attribution = (await service().createOrResolveAttribution({ code: "PH7-AVA-72", journeyId: "00000000-0000-4000-8000-000000000005", now })).attribution;
    const markup = renderToStaticMarkup(<LocalContinuation attribution={attribution} />);
    expect(markup).toContain(attribution.attributionId);
    expect(markup).toContain("Opaque attribution reference");
    expect(markup).not.toContain("synthetic-ava");
    expect(markup).not.toContain("ph7.health");
  });
});
