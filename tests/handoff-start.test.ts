import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/auth/handoff/start/route";

const validCode = "AbC123def456GHI789jkl012MNO345pqr678STU901vwx234";

function request(code: string | null): Request {
  const url = new URL("https://refer.ph7.health/auth/handoff/start");
  if (code !== null) url.searchParams.set("code", code);
  return new Request(url);
}

describe("handoff browser start endpoint", () => {
  it("redirects a valid 48-character alphanumeric code to the fixed pH7 handoff URL", () => {
    const response = GET(request(validCode));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`https://app.ph7.health/referral/handoff/${validCode}`);
  });

  it("rejects a missing code without redirecting", () => {
    const response = GET(request(null));
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects a code shorter than 48 characters", () => {
    const response = GET(request("A".repeat(47)));
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects a code longer than 48 characters", () => {
    const response = GET(request("A".repeat(49)));
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects invalid characters", () => {
    const response = GET(request(`${"A".repeat(47)}-`));
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects URL and redirect injection attempts without external redirect", () => {
    const response = GET(request("https://evil.example/referral/handoff/attack"));
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("sets Cache-Control no-store on valid and invalid responses", () => {
    expect(GET(request(validCode)).headers.get("cache-control")).toBe("no-store");
    expect(GET(request(null)).headers.get("cache-control")).toBe("no-store");
  });

  it("does not include database, session, JWT, or referral-write dependencies", () => {
    const routePath = fileURLToPath(new URL("../app/auth/handoff/start/route.ts", import.meta.url));
    const source = readFileSync(routePath, "utf8");
    expect(source).not.toMatch(/getPostgresExecutor|ReferralSessionService|getReferralSessionService|writePatientSession|readHandoffToken|referral_users|referral_codes|referral_attributions|consumeHandoff|nonce/i);
  });
});
