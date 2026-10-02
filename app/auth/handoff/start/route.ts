import { NextResponse } from "next/server";

export const runtime = "nodejs";

const handoffCodePattern = /^[A-Za-z0-9]{48}$/;
const handoffStartBaseUrl = "https://app.ph7.health/referral/handoff/";

function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}

export function GET(request: Request): Response {
  const code = new URL(request.url).searchParams.get("code");
  if (!code || !handoffCodePattern.test(code)) {
    return noStore(new NextResponse("Invalid hand-off start code.", { status: 400 }));
  }
  return noStore(NextResponse.redirect(`${handoffStartBaseUrl}${code}`, 302));
}
