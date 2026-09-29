import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getLocalReferralEngine, localWebhookSecret } from "@/lib/local/engine";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const payload = await request.text();
  const signature = createHmac("sha256", localWebhookSecret()).update(payload).digest("hex");
  try { const result = await getLocalReferralEngine().processWebhook(payload, signature, localWebhookSecret()); return NextResponse.json({ simulated: true, duplicate: result.duplicate }); }
  catch { return NextResponse.json({ simulated: false, error: "Simulation could not be processed." }, { status: 400 }); }
}
