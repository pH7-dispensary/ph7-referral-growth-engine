import "server-only";

import { createHmac } from "node:crypto";
import { secureEqual } from "@/lib/auth/crypto";

const defaultToleranceSeconds = 300;

export function webhookTimestampToleranceSeconds(value = process.env.PH7_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS): number {
  if (!value) return defaultToleranceSeconds;
  if (!/^\d+$/.test(value)) return defaultToleranceSeconds;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 900 ? parsed : defaultToleranceSeconds;
}

export function isFreshWebhookTimestamp(timestamp: string | null | undefined, now = new Date(), toleranceSeconds = defaultToleranceSeconds): boolean {
  if (!timestamp || timestamp.length > 64) return false;
  const receivedAt = new Date(timestamp);
  if (!Number.isFinite(receivedAt.getTime()) || receivedAt.toISOString() !== timestamp) return false;
  const skew = Math.abs(now.getTime() - receivedAt.getTime());
  return skew <= toleranceSeconds * 1_000;
}

export function webhookSignaturePayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

/** Timestamp-bound raw-body HMAC check shared by the runtime route without consulting local state. */
export function verifyWebhookSignature(input: { body: string; signature: string; secret: string | undefined; timestamp: string | null | undefined; now?: Date; toleranceSeconds?: number }): boolean {
  const { body, signature, secret, timestamp, now = new Date(), toleranceSeconds = defaultToleranceSeconds } = input;
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  if (!isFreshWebhookTimestamp(timestamp, now, toleranceSeconds)) return false;
  const expected = createHmac("sha256", secret).update(webhookSignaturePayload(timestamp!, body)).digest("hex");
  return secureEqual(expected, signature);
}
