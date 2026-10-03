import "server-only";
import { createHash, scrypt, timingSafeEqual } from "node:crypto";
import type { AdminIdentityProvider, VerifiedAdminIdentity } from "@/lib/auth/types";

export interface AdminCredential { emailHash: string; salt: string; passwordHash: string }
export function adminCredential(value = process.env.ADMIN_LOGIN_CREDENTIAL): AdminCredential | null {
  try {
    const parsed = JSON.parse(value ?? "");
    if (parsed.version !== 1 || !/^[a-f0-9]{64}$/.test(parsed.emailHash) || !/^[a-f0-9]{32}$/.test(parsed.salt) || !/^[a-f0-9]{128}$/.test(parsed.passwordHash)) return null;
    return { emailHash: parsed.emailHash, salt: parsed.salt, passwordHash: parsed.passwordHash };
  } catch { return null; }
}
export function passwordDigest(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, Buffer.from(salt, "hex"), 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }, (error, digest) => error ? reject(error) : resolve(digest)));
}
/** A single server-configured founder, with no registration or browser-selected role. */
export class FounderPasswordProvider implements AdminIdentityProvider {
  constructor(private readonly credential: AdminCredential | null = adminCredential()) {}
  async verifyAdminIdentity(input: unknown): Promise<VerifiedAdminIdentity> {
    if (!this.credential || !input || typeof input !== "object") throw new Error("Sign-in failed.");
    const { email, password } = input as Record<string, unknown>;
    if (typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length < 1 || Buffer.byteLength(password) > 1024) throw new Error("Sign-in failed.");
    const emailHash = createHash("sha256").update(email.trim().toLowerCase()).digest();
    // Always perform the same password KDF even for an unknown email.
    const digest = await passwordDigest(password, this.credential.salt);
    const emailMatches = timingSafeEqual(emailHash, Buffer.from(this.credential.emailHash, "hex"));
    const passwordMatches = timingSafeEqual(digest, Buffer.from(this.credential.passwordHash, "hex"));
    if (!emailMatches || !passwordMatches) throw new Error("Sign-in failed.");
    return { emailHash: this.credential.emailHash, role: "FOUNDER" };
  }
}
