import { afterEach, describe, expect, it, vi } from "vitest";
import IntegrationPage from "@/app/integration/page";
import { referralPublicOrigin } from "@/lib/portal/public-url";
import { buildReferralUrl } from "@/lib/portal/referral-link";

afterEach(() => vi.unstubAllEnvs());

describe("production release boundaries", () => {
  it.each(["APP_ENV", "VERCEL_ENV"])("uses the canonical referral domain when %s identifies production", (flag) => {
    const origin = referralPublicOrigin({ [flag]: "production", VERCEL_URL: "preview.vercel.app" });
    expect(buildReferralUrl("PH7ABCDEF1234", origin)).toBe("https://refer.ph7.health/r/PH7ABCDEF1234");
  });
  it.each(["http://localhost:3000", "https://preview.vercel.app", "https://attacker.invalid"])("rejects a noncanonical production origin: %s", (origin) => {
    expect(() => referralPublicOrigin({ APP_ENV: "production", REFERRAL_PUBLIC_URL: origin })).toThrow("canonical");
  });
  it("retains explicit preview and development origins", () => {
    expect(referralPublicOrigin({ APP_ENV: "preview", VERCEL_URL: "preview.vercel.app" })).toBe("https://preview.vercel.app");
    expect(referralPublicOrigin({ NODE_ENV: "development" })).toBe("http://localhost:3000");
  });
  it.each([
    { NODE_ENV: "production", APP_ENV: "production", VERCEL_ENV: "production", REFERRAL_DEMO_MODE: "false" },
    { NODE_ENV: "production", APP_ENV: "preview", VERCEL_ENV: "production", REFERRAL_DEMO_MODE: "true" },
    { NODE_ENV: "test", APP_ENV: "", VERCEL_ENV: "", REFERRAL_DEMO_MODE: "false" },
  ])("does not expose integration/demo UI in production or tests", (environment) => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    expect(() => IntegrationPage()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
  it.each(["development", "preview"])("preserves explicit %s developer review", (environment) => {
    vi.stubEnv("NODE_ENV", environment === "development" ? "development" : "production");
    vi.stubEnv("APP_ENV", environment === "preview" ? "preview" : "development");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("REFERRAL_DEMO_MODE", environment === "preview" ? "true" : "false");
    expect(IntegrationPage()).toBeTruthy();
  });
});
