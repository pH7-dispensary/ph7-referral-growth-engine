import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleHandoffStart } from "@/app/auth/handoff/start/route";
import type { SessionMaterial } from "@/lib/auth/types";
import { hasPatientAccess } from "@/lib/auth/authorization";
import { webhookSignaturePayload } from "@/lib/webhook/signature";

const validCode = "AbC123def456GHI789jkl012MNO345pqr678STU901vwx234";
const timestamp = "2026-10-03T12:00:00.000Z";
const secret = "synthetic-webhook-secret";
const token = "header.payload.signature";
const session: SessionMaterial = {
  token: "opaque-session-token",
  csrfToken: "opaque-csrf-token",
  expiresAt: new Date("2026-10-03T13:00:00.000Z"),
  subject: { kind: "PATIENT", referralUserId: "synthetic-referral-user" },
};

type Mutable<T> = { -readonly [P in keyof T]: T[P] };
type Dependencies = Parameters<typeof handleHandoffStart>[1];

function request(code: string | null): Request {
  const url = new URL("https://refer.ph7.health/auth/handoff/start");
  if (code !== null) url.searchParams.set("code", code);
  return new Request(url);
}

function dependencies(overrides: Partial<Mutable<Dependencies>> = {}) {
  const calls = { fetch: 0, begin: 0, write: 0, logs: [] as Array<{ level: string; message: string; metadata: Record<string, string> }>, fetched: null as RequestInit | null };
  const deps: Dependencies = {
    fetch: (async (_url, init) => {
      calls.fetch += 1;
      calls.fetched = init ?? null;
      return new Response(JSON.stringify({ token, expires_at: "2026-10-03T12:02:00.000Z" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
    now: () => new Date(timestamp),
    webhookSecret: secret,
    beginPatientSession: async (value) => {
      calls.begin += 1;
      if (value !== token) throw new Error("unexpected token");
      return session;
    },
    writePatientSession: async (_session, response) => {
      calls.write += 1;
      response.headers.append("set-cookie", "ph7_referral_patient_session=opaque; HttpOnly; Secure; SameSite=Lax; Path=/");
    },
    log: (level, message, metadata) => { calls.logs.push({ level, message, metadata }); },
    ...overrides,
  };
  return { calls, deps };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("handoff browser start redemption endpoint", () => {
  it("redeems a valid code, creates a session, and redirects to /portal with Set-Cookie", async () => {
    const { calls, deps } = dependencies();
    const response = await handleHandoffStart(request(validCode), deps);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://refer.ph7.health/portal");
    expect(response.headers.get("set-cookie")).toContain("ph7_referral_patient_session=");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls.fetch).toBe(1);
    expect(calls.begin).toBe(1);
    expect(calls.write).toBe(1);
  });

  it("creates patient session material that satisfies the portal patient-access check", async () => {
    const { deps } = dependencies();
    await handleHandoffStart(request(validCode), deps);
    expect(hasPatientAccess({
      id: "synthetic-session",
      kind: "PATIENT",
      referralUserId: session.subject.kind === "PATIENT" ? session.subject.referralUserId : "",
      tokenHash: "token-hash",
      csrfTokenHash: "csrf-hash",
      expiresAt: session.expiresAt,
      invalidatedAt: null,
    })).toBe(true);
  });

  it("sends the exact signed server-side redemption request", async () => {
    const { calls, deps } = dependencies();
    await handleHandoffStart(request(validCode), deps);
    const body = JSON.stringify({ code: validCode });
    const expectedSignature = createHmac("sha256", secret).update(webhookSignaturePayload(timestamp, body)).digest("hex");
    expect(calls.fetched).toMatchObject({ method: "POST", body, cache: "no-store" });
    const headers = new Headers(calls.fetched?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-ph7-timestamp")).toBe(timestamp);
    expect(headers.get("x-ph7-signature")).toBe(expectedSignature);
  });

  it("rejects an invalid code before redemption or session work", async () => {
    const { calls, deps } = dependencies();
    const response = await handleHandoffStart(request("A".repeat(47)), deps);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls.fetch).toBe(0);
    expect(calls.begin).toBe(0);
    expect(calls.write).toBe(0);
  });

  it("rejects URL injection attempts before redemption", async () => {
    const { calls, deps } = dependencies();
    const response = await handleHandoffStart(request("https://evil.example/referral/handoff/attack"), deps);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(calls.fetch).toBe(0);
  });

  it.each([
    [410, "REDEEM_CODE_EXPIRED_OR_USED"],
    [401, "REDEEM_AUTH_REJECTED"],
    [503, "REDEEM_UPSTREAM_FAILURE"],
  ])("fails closed when redemption returns %s", async (status, reason) => {
    const { calls, deps } = dependencies({ fetch: (async () => new Response("{}", { status })) as typeof fetch });
    const response = await handleHandoffStart(request(validCode), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(calls.begin).toBe(0);
    expect(calls.write).toBe(0);
    expect(calls.logs.at(-1)?.metadata.reason).toBe(reason);
  });

  it("fails closed on redemption timeout", async () => {
    vi.useFakeTimers();
    const { calls, deps } = dependencies({
      fetch: ((_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      })) as typeof fetch,
    });
    const promise = handleHandoffStart(request(validCode), deps);
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await promise;
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(calls.begin).toBe(0);
    expect(calls.logs.at(-1)?.metadata.reason).toBe("REDEEM_TIMEOUT");
  });

  it.each([
    ["missing token", "{}"],
    ["malformed JSON", "not-json"],
  ])("fails closed on malformed 200 response: %s", async (_name, body) => {
    const { calls, deps } = dependencies({ fetch: (async () => new Response(body, { status: 200 })) as typeof fetch });
    const response = await handleHandoffStart(request(validCode), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(calls.begin).toBe(0);
    expect(calls.write).toBe(0);
    expect(calls.logs.at(-1)?.metadata.reason).toBe("REDEEM_MALFORMED_RESPONSE");
  });

  it("uses existing handoff verification/session path and fails closed for invalid or replayed JWTs", async () => {
    const { calls, deps } = dependencies({
      beginPatientSession: async () => {
        calls.begin += 1;
        throw new Error("Handoff nonce has already been consumed.");
      },
    });
    const response = await handleHandoffStart(request(validCode), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(calls.begin).toBe(1);
    expect(calls.write).toBe(0);
    expect(calls.logs.at(-1)?.metadata.reason).toBe("REDEEMED_JWT_REJECTED");
  });

  it("does not include caller-controlled redemption URLs or direct database/referral writes", () => {
    const routePath = fileURLToPath(new URL("../app/auth/handoff/start/route.ts", import.meta.url));
    const source = readFileSync(routePath, "utf8");
    expect(source).toContain("https://app.ph7.health/api/v1/referral/handoff/redeem");
    expect(source).not.toMatch(/searchParams\.get\(["'](?:redirect|return|url|host|origin|destination)/);
    expect(source).not.toMatch(/getPostgresExecutor|referral_users|referral_codes|referral_attributions|INSERT INTO|UPDATE referral_/i);
  });
});
