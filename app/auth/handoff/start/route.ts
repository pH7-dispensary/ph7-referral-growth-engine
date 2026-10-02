import { NextResponse } from "next/server";
import type { SessionMaterial } from "@/lib/auth/types";
import { getReferralSessionService, writePatientSession } from "@/lib/auth/server";
import { createWebhookSignature } from "@/lib/webhook/signature";

export const runtime = "nodejs";

const handoffCodePattern = /^[A-Za-z0-9]{48}$/;
const redemptionUrl = "https://app.ph7.health/api/v1/referral/handoff/redeem";
const timeoutMilliseconds = 5_000;

type HandoffStartDependencies = {
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly webhookSecret: string | undefined;
  readonly beginPatientSession: (token: string) => Promise<SessionMaterial>;
  readonly writePatientSession: (session: SessionMaterial, response: NextResponse) => Promise<void>;
  readonly log: (level: "warn" | "error", message: string, metadata: Record<string, string>) => void;
};

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

function invalidCode(): NextResponse {
  return noStore(new NextResponse("Invalid hand-off start code.", { status: 400 }));
}

function fallback(status = 200): NextResponse {
  return noStore(new NextResponse("<!doctype html><title>Open from pH7</title><main style=\"font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.25rem;line-height:1.45\"><h1>Open pH7 Refer from the pH7 app.</h1><p>This secure referral page needs to be opened from your signed-in pH7 account. Please go back to the pH7 app and tap <strong>pH7 Refer</strong> again.</p></main>", {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  }));
}

function diagnostic(dependencies: HandoffStartDependencies, level: "warn" | "error", reason: string): void {
  dependencies.log(level, "[auth/handoff/start] rejected", { reason });
}

async function redeemCode(code: string, dependencies: HandoffStartDependencies): Promise<Response> {
  if (!dependencies.webhookSecret) throw new Error("missing-secret");
  const body = JSON.stringify({ code });
  const timestamp = dependencies.now().toISOString();
  const signature = createWebhookSignature({ body, secret: dependencies.webhookSecret, timestamp });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    return await dependencies.fetch(redemptionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ph7-timestamp": timestamp,
        "x-ph7-signature": signature,
      },
      body,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readRedeemedToken(response: Response): Promise<string | null> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || typeof (payload as { token?: unknown }).token !== "string") return null;
  const token = (payload as { token: string }).token;
  return token.length >= 16 && token.length <= 8_192 ? token : null;
}

export async function handleHandoffStart(request: Request, dependencies: HandoffStartDependencies): Promise<NextResponse> {
  const code = new URL(request.url).searchParams.get("code");
  if (!code || !handoffCodePattern.test(code)) return invalidCode();

  let redemption: Response;
  try {
    redemption = await redeemCode(code, dependencies);
  } catch (error) {
    diagnostic(dependencies, "error", error instanceof Error && error.name === "AbortError" ? "REDEEM_TIMEOUT" : "REDEEM_NETWORK_OR_CONFIG_FAILURE");
    return fallback();
  }

  if (redemption.status === 410) {
    diagnostic(dependencies, "warn", "REDEEM_CODE_EXPIRED_OR_USED");
    return fallback();
  }
  if (redemption.status === 401) {
    diagnostic(dependencies, "error", "REDEEM_AUTH_REJECTED");
    return fallback();
  }
  if (redemption.status >= 500) {
    diagnostic(dependencies, "error", "REDEEM_UPSTREAM_FAILURE");
    return fallback();
  }
  if (redemption.status !== 200) {
    diagnostic(dependencies, "warn", "REDEEM_UNEXPECTED_STATUS");
    return fallback();
  }

  const token = await readRedeemedToken(redemption);
  if (!token) {
    diagnostic(dependencies, "error", "REDEEM_MALFORMED_RESPONSE");
    return fallback();
  }

  let session: SessionMaterial;
  try {
    session = await dependencies.beginPatientSession(token);
  } catch {
    diagnostic(dependencies, "warn", "REDEEMED_JWT_REJECTED");
    return fallback();
  }

  const response = noStore(NextResponse.redirect(new URL("/portal", request.url), 303));
  await dependencies.writePatientSession(session, response);
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  return handleHandoffStart(request, {
    fetch,
    now: () => new Date(),
    webhookSecret: process.env.PH7_WEBHOOK_SECRET,
    beginPatientSession: (token) => getReferralSessionService().beginPatientSession(token),
    writePatientSession: async (session) => { await writePatientSession(session); },
    log: (level, message, metadata) => {
      if (level === "error") console.error(message, metadata);
      else console.warn(message, metadata);
    },
  });
}
