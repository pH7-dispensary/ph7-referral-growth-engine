import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const minimumSecretLength = 32;

export class AuthenticationConfigurationError extends Error {}

export function requireSessionSecret(value: string | undefined, name: string): string {
  if (!value || value.length < minimumSecretLength) {
    throw new AuthenticationConfigurationError(`${name} must be configured with at least ${minimumSecretLength} characters.`);
  }
  return value;
}

export function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hmacDigest(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
