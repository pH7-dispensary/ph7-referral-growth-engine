import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { getLocalReferralEngine, localWebhookSecret } from "@/lib/local/engine";
import { getPostgresRuntime } from "@/lib/persistence/runtime";
import { verifyWebhookSignature, webhookTimestampToleranceSeconds } from "@/lib/webhook/signature";

export const runtime = "nodejs";

const payloadSchema = z.object({
  event_id: z.string().min(1).max(160),
  type: z.enum(["consultation.paid", "consultation.refunded"]),
  attribution_id: z.string().min(1).max(160),
  timestamp: z.string().datetime(),
});

function permanentFailure(status = 400) {
  return NextResponse.json({ received: false, error: "Webhook could not be accepted." }, { status });
}

function temporaryFailure() {
  return NextResponse.json({ received: false, error: "Webhook could not be processed." }, { status: 503 });
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-ph7-signature") ?? "";
  const timestamp = request.headers.get("x-ph7-timestamp");
  const toleranceSeconds = webhookTimestampToleranceSeconds();
  try {
    const database = getPostgresRuntime();
    if (database) {
      // A database-configured runtime never falls back to synthetic state or its
      // development secret. The future provider secret stays server-only.
      if (!verifyWebhookSignature({ body, signature, timestamp, secret: process.env.PH7_WEBHOOK_SECRET, toleranceSeconds })) return permanentFailure();
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return permanentFailure(); }
      const payload = payloadSchema.safeParse(parsed);
      if (!payload.success || payload.data.timestamp !== timestamp) return permanentFailure();
      const result = await database.processWebhook({ eventId: payload.data.event_id, eventType: payload.data.type, attributionPublicId: payload.data.attribution_id, payloadHash: signature });
      return NextResponse.json({ received: true, duplicate: result.duplicate, unknownAttribution: Boolean(result.unknownAttribution) });
    }
    if (process.env.NODE_ENV !== "development") throw new Error("Webhook runtime is unavailable.");
    if (!verifyWebhookSignature({ body, signature, timestamp, secret: localWebhookSecret(), toleranceSeconds })) return permanentFailure();
    const localSignature = createHmac("sha256", localWebhookSecret()).update(body).digest("hex");
    const result = await getLocalReferralEngine().processWebhook(body, localSignature, localWebhookSecret());
    return NextResponse.json({ received: true, duplicate: result.duplicate });
  } catch {
    // No provider, referral, or validation details leak to the caller.
    return temporaryFailure();
  }
}
