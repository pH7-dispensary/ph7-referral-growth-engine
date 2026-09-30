import { NextResponse } from "next/server";
import { getReferralSessionService, writePatientSession } from "@/lib/auth/server";
import { readHandoffToken } from "@/lib/auth/handoff-request";

export const runtime = "nodejs";

function rejected() {
  return new NextResponse("<!doctype html><title>Referral access unavailable</title><p>Referral access could not be accepted.</p>", {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const session = await getReferralSessionService().beginPatientSession(await readHandoffToken(request));
    await writePatientSession(session);
    return NextResponse.redirect(new URL("/portal", request.url), 303);
  } catch {
    return rejected();
  }
}
