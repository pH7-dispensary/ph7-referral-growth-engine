import { NextResponse } from "next/server";
import { getLocalReferralEngine, localWebhookSecret } from "@/lib/local/engine";
import { getPostgresRuntime } from "@/lib/persistence/runtime";
import { verifyWebhookSignature } from "@/lib/webhook/signature";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-ph7-signature") ?? "";
  try {
    const database = getPostgresRuntime();
    if (database) {
      // A database-configured runtime never falls back to synthetic state or its
      // development secret. The future provider secret stays server-only.
      if (!verifyWebhookSignature(body, signature, process.env.PH7_WEBHOOK_SECRET)) throw new Error("Invalid signature");
      const payload = JSON.parse(body) as { event_id: string; type: "consultation.paid" | "consultation.refunded"; attribution_id: string };
      const result = await database.processWebhook({ eventId: payload.event_id, eventType: payload.type, attributionPublicId: payload.attribution_id });
      return NextResponse.json({ received: true, duplicate: result.duplicate });
    }
    if (process.env.NODE_ENV !== "development") throw new Error("Webhook runtime is unavailable.");
    if (!verifyWebhookSignature(body, signature, localWebhookSecret())) throw new Error("Invalid signature");
    const result = await getLocalReferralEngine().processWebhook(body, signature, localWebhookSecret());
    return NextResponse.json({ received: true, duplicate: result.duplicate });
  } catch {
    // No provider, referral, or validation details leak to the caller.
    return NextResponse.json({ received: false, error: "Webhook could not be processed." }, { status: 400 });
  }
}
