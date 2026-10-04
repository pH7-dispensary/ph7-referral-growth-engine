import { NextResponse } from "next/server";
import { z } from "zod";
import { getPostgresRuntime } from "@/lib/persistence/runtime";
import { verifyWebhookSignature, webhookTimestampToleranceSeconds } from "@/lib/webhook/signature";

export const runtime = "nodejs";

/**
 * Server-to-server for the pH7 backend: returns the friend incentive SNAPSHOTTED
 * on an attribution so pH7 checkout applies exactly that amount. Same signature
 * contract as /api/webhooks/ph7 (hex HMAC-SHA256 over "<timestamp>.<raw body>",
 * x-ph7-timestamp equal to the signed timestamp). Read-only.
 */
const requestSchema = z.object({
  attribution_id: z.string().regex(/^attr_[0-9a-f]{32}$/),
  patient_reference: z.string().regex(/^pat_[a-z]{2}_[0-9]+$/),
}).strict();

type Resolution =
  | { status: "ok"; friendIncentiveMinor: number; currency: "EUR" }
  | { status: "unknown" }
  | { status: "self_referral" };

export type AttributionResolveDependencies = {
  readonly secret: string | undefined;
  readonly toleranceSeconds: number;
  readonly resolve: ((attributionId: string, patientReference: string) => Promise<Resolution>) | null;
};

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function handleAttributionResolve(request: Request, dependencies: AttributionResolveDependencies): Promise<NextResponse> {
  const body = await request.text();
  if (!dependencies.resolve || !dependencies.secret) return json({ error: "unavailable" }, 503);
  const verified = verifyWebhookSignature({
    body,
    signature: request.headers.get("x-ph7-signature") ?? "",
    timestamp: request.headers.get("x-ph7-timestamp"),
    secret: dependencies.secret,
    toleranceSeconds: dependencies.toleranceSeconds,
  });
  if (!verified) return json({ error: "unauthorized" }, 401);

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(JSON.parse(body));
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  let resolution: Resolution;
  try {
    resolution = await dependencies.resolve(parsed.attribution_id, parsed.patient_reference);
  } catch {
    return json({ error: "temporarily_unavailable" }, 503);
  }
  if (resolution.status === "unknown") return json({ error: "unknown_attribution" }, 404);
  if (resolution.status === "self_referral") return json({ error: "self_referral" }, 409);
  return json({
    attribution_id: parsed.attribution_id,
    friend_incentive_minor: resolution.friendIncentiveMinor,
    currency: resolution.currency,
  }, 200);
}

export async function POST(request: Request): Promise<NextResponse> {
  const database = getPostgresRuntime();
  return handleAttributionResolve(request, {
    secret: process.env.PH7_WEBHOOK_SECRET,
    toleranceSeconds: webhookTimestampToleranceSeconds(),
    resolve: database ? (attributionId, patientReference) => database.resolveAttributionIncentive(attributionId, patientReference) : null,
  });
}
