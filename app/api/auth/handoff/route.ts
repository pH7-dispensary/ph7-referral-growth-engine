import { NextResponse } from "next/server";
import { getReferralSessionService, writePatientSession } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { token?: unknown };
    if (!payload || typeof payload.token !== "string" || payload.token.length > 8_192) throw new Error("Rejected hand-off.");
    const session = await getReferralSessionService().beginPatientSession(payload.token);
    await writePatientSession(session);
    return NextResponse.json({ accepted: true });
  } catch {
    // Do not disclose token, issuer, signature, expiry, or replay details.
    return NextResponse.json({ accepted: false, error: "Secure hand-off could not be accepted." }, { status: 401 });
  }
}
