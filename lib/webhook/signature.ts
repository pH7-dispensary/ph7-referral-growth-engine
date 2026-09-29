import "server-only";

import { createHmac } from "node:crypto";
import { secureEqual } from "@/lib/auth/crypto";

/** Raw-body HMAC check shared by the runtime route without consulting local state. */
export function verifyWebhookSignature(body: string, signature: string, secret: string | undefined): boolean {
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  return secureEqual(expected, signature);
}
