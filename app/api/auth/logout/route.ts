import { NextResponse } from "next/server";
import { assertSessionCsrf, currentAdminSession, currentPatientSession, logoutCurrentSessions } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const csrf = request.headers.get("x-csrf-token") ?? undefined;
    const [patient, admin] = await Promise.all([currentPatientSession(), currentAdminSession()]);
    if (patient) assertSessionCsrf("PATIENT", patient, csrf);
    else if (admin) assertSessionCsrf("ADMIN", admin, csrf);
    else return NextResponse.json({ accepted: false }, { status: 401 });
    await logoutCurrentSessions();
    return NextResponse.json({ accepted: true });
  } catch {
    return NextResponse.json({ accepted: false }, { status: 403 });
  }
}
