import { NextResponse } from "next/server";
import { getReferralSessionService, writePatientSession } from "@/lib/auth/server";
import { readHandoffToken } from "@/lib/auth/handoff-request";
import { HandoffRejectedError } from "@/lib/auth/handoff";

export const runtime = "nodejs";

function rejected() {
  return new NextResponse("<!doctype html><title>Referral access unavailable</title><p>Referral access could not be accepted.</p>", {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function unavailable(status = 405) {
  return new NextResponse("<!doctype html><title>Open from pH7</title><main style=\"font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.25rem;line-height:1.45\"><h1>Open pH7 Refer from the pH7 app.</h1><p>This secure referral page needs to be opened from your signed-in pH7 account. Please go back to the pH7 app and tap <strong>pH7 Refer</strong> again.</p></main>", {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function logRejected(stage: "read_token" | "begin_session" | "unexpected", error: unknown): void {
  const reason = error instanceof HandoffRejectedError
    ? "HANDOFF_VERIFICATION_REJECTED"
    : error instanceof Error && error.message.includes("nonce")
      ? "HANDOFF_REPLAY_REJECTED"
      : error instanceof Error && error.message.includes("Referral code")
        ? "REFERRAL_CODE_ISSUANCE_FAILED"
        : "HANDOFF_REQUEST_REJECTED";
  console.warn("[auth/handoff] rejected", { stage, reason });
}

export function GET() {
  console.warn("[auth/handoff] rejected", { stage: "method", reason: "GET_NOT_ALLOWED" });
  return unavailable();
}

export async function POST(request: Request) {
  try {
    let token: string;
    try {
      token = await readHandoffToken(request);
    } catch (error) {
      logRejected("read_token", error);
      return rejected();
    }
    let session: Awaited<ReturnType<ReturnType<typeof getReferralSessionService>["beginPatientSession"]>>;
    try {
      session = await getReferralSessionService().beginPatientSession(token);
    } catch (error) {
      logRejected("begin_session", error);
      return rejected();
    }
    await writePatientSession(session);
    return NextResponse.redirect(new URL("/portal", request.url), 303);
  } catch (error) {
    logRejected("unexpected", error);
    return rejected();
  }
}
