import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from "jose";
import { hmacDigest } from "@/lib/auth/crypto";
import { RemoteJwksHandoffVerifier } from "@/lib/auth/handoff";
import { PostgresAuthRepository } from "@/lib/auth/postgres";
import { ReferralSessionService } from "@/lib/auth/session";
import { getPostgresExecutor, resetPostgresExecutorForTest } from "@/lib/persistence/node-postgres";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd());

const token = randomUUID().replaceAll("-", "");
const patientReference = `pat_eu_test_${token}`;
const patientSecret = "test-patient-session-secret-that-is-long-enough-for-hmac";
const adminSecret = "test-admin-session-secret-that-is-long-enough-for-hmac";
const issuer = `https://synthetic-handoff-${token}.invalid`;
const audience = "ph7-referral-growth-engine-test";
const jwksUrl = "https://synthetic-jwks.test.invalid/.well-known/jwks.json";

function service(verifier: RemoteJwksHandoffVerifier) {
  return new ReferralSessionService(new PostgresAuthRepository(getPostgresExecutor()), {
    patientSessionSecret: patientSecret, adminSessionSecret: adminSecret,
    handoffVerifier: verifier,
  });
}

async function main(): Promise<void> {
  const now = new Date(); const nonce = `nonce-${token}-abcdefghijkl`;
  const issuedAt = Math.floor(now.getTime() / 1_000) - 1;
  const expiresAt = issuedAt + 60;
  const keys = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(keys.publicKey);
  const jwks: JSONWebKeySet = { keys: [{ ...publicJwk, kid: `synthetic-key-${token}`, use: "sig", alg: "RS256" }] };
  const verifier = new RemoteJwksHandoffVerifier({
    jwksUrl, issuer, audience, algorithms: ["RS256"], maximumLifetimeSeconds: 120,
    fetch: async () => new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const handoff = await new SignJWT({ patient_reference: patientReference, email_hash: "c".repeat(64), nonce, issued_at: new Date(issuedAt * 1_000).toISOString(), expires_at: new Date(expiresAt * 1_000).toISOString() })
    .setProtectedHeader({ alg: "RS256", kid: `synthetic-key-${token}`, typ: "JWT" })
    .setIssuer(issuer).setAudience(audience).setIssuedAt(issuedAt).setNotBefore(issuedAt).setExpirationTime(expiresAt).sign(keys.privateKey);
  try {
    const auth = service(verifier);
    const attempts = await Promise.allSettled([auth.beginPatientSession(handoff, now), auth.beginPatientSession(handoff, now)]);
    const accepted = attempts.filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof auth.beginPatientSession>>> => attempt.status === "fulfilled");
    if (accepted.length !== 1) throw new Error("Exactly one concurrent hand-off must be accepted.");
    await resetPostgresExecutorForTest();
    const restored = await service(verifier).readPatientSession(accepted[0].value.token, now);
    if (!restored || restored.kind !== "PATIENT") throw new Error("Patient session was not retrievable after repository reinitialisation.");
    service(verifier).assertCsrf(restored, accepted[0].value.csrfToken, patientSecret);
    await service(verifier).endPatientSession(accepted[0].value.token);
    if (await service(verifier).readPatientSession(accepted[0].value.token, now)) throw new Error("Invalidated session remained active.");
    console.log("PostgreSQL asymmetric-JWKS hand-off replay, CSRF, invalidation, and restart-persistence test passed.");
  } finally {
    const sql = getPostgresExecutor();
    await sql.transaction(async (transaction) => {
      await transaction.query("DELETE FROM referral_auth_sessions WHERE referral_user_id IN (SELECT id FROM referral_users WHERE patient_reference=$1)", [patientReference]);
      await transaction.query("DELETE FROM referral_handoff_nonces WHERE issuer=$1", [issuer]);
      await transaction.query("DELETE FROM referral_users WHERE patient_reference=$1", [patientReference]);
    });
    await resetPostgresExecutorForTest();
  }
}

void main();
