import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(value = process.env.PAYOUT_DATA_ENCRYPTION_KEY): Buffer {
  if (!value || !(/^[a-fA-F0-9]{64}$/.test(value) || /^[A-Za-z0-9+/]{43}=$/.test(value))) throw new Error("Secure payout storage is unavailable.");
  const key = Buffer.from(value, /^[a-fA-F0-9]{64}$/.test(value) ? "hex" : "base64");
  if (key.length !== 32) throw new Error("Secure payout storage is unavailable.");
  if (!/^[a-fA-F0-9]{64}$/.test(value) && key.toString("base64") !== value) throw new Error("Secure payout storage is unavailable.");
  return key;
}
export function payoutStorageConfigured(): boolean {
  try { encryptionKey(); return true; } catch { return false; }
}
/** Versioned AES-256-GCM envelope. AAD binds ciphertext to its authenticated owner. */
export function encryptPayoutIban(iban: string, referralUserId: string, keyValue?: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyValue), iv);
  cipher.setAAD(Buffer.from(`payout-account:${referralUserId}`));
  const encrypted = Buffer.concat([cipher.update(iban, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
}
/** Server-only operational seam; never return decrypted values to patient UI. */
export function decryptPayoutIban(envelope: Buffer, referralUserId: string, keyValue?: string): string {
  if (envelope[0] !== 1 || envelope.length <= 29) throw new Error("Invalid encrypted payout data.");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(keyValue), envelope.subarray(1,13));
  cipher.setAAD(Buffer.from(`payout-account:${referralUserId}`));
  cipher.setAuthTag(envelope.subarray(13,29));
  return Buffer.concat([cipher.update(envelope.subarray(29)), cipher.final()]).toString("utf8");
}
