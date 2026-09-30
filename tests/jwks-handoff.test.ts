import { generateKeyPair, exportJWK, SignJWT, type JWSAlgorithm, type JSONWebKeySet } from "jose";
import { describe, expect, it } from "vitest";
import { HandoffRejectedError, handoffVerifierFromEnvironment, RemoteJwksHandoffVerifier, UnconfiguredJwksHandoffVerifier } from "@/lib/auth/handoff";

const now = new Date("2026-09-24T12:00:00.000Z");
const issuer = "https://synthetic-handoff.test.invalid";
const audience = "ph7-referral-growth-engine";
const jwksUrl = "https://synthetic-jwks.test.invalid/.well-known/jwks.json";

async function signer(kid: string, algorithm: JWSAlgorithm = "RS256") {
  const keys = await generateKeyPair(algorithm);
  const publicJwk = await exportJWK(keys.publicKey);
  return {
    kid,
    algorithm,
    privateKey: keys.privateKey,
    jwks: { keys: [{ ...publicJwk, kid, use: "sig", alg: algorithm }] } satisfies JSONWebKeySet,
  };
}

async function handoff(privateKey: CryptoKey, kid: string, overrides: Partial<{
  audience: string;
  issuedAt: number;
  expiresAt: number;
  notBefore: number;
  emailHash: string | null;
  nonce: string;
  patientReference: string;
}> = {}) {
  const issuedAt = overrides.issuedAt ?? Math.floor(now.getTime() / 1_000) - 1;
  const expiresAt = overrides.expiresAt ?? Math.floor(now.getTime() / 1_000) + 60;
  const payload = {
    patient_reference: overrides.patientReference ?? "pat_eu_jwks_11_6",
    ...(overrides.emailHash === null ? {} : { email_hash: overrides.emailHash ?? "d".repeat(64) }),
    nonce: overrides.nonce ?? "nonce-synthetic-jwks-11-6-abcdefghijkl",
    issued_at: new Date(issuedAt * 1_000).toISOString(),
    expires_at: new Date(expiresAt * 1_000).toISOString(),
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(overrides.audience ?? audience)
    .setIssuedAt(issuedAt)
    .setNotBefore(overrides.notBefore ?? issuedAt)
    .setExpirationTime(expiresAt)
    .sign(privateKey);
}

function responder(current: () => JSONWebKeySet, calls: { count: number }) {
  return async (): Promise<Response> => {
    calls.count += 1;
    return new Response(JSON.stringify(current()), { status: 200, headers: { "content-type": "application/json" } });
  };
}

function verifier(jwks: () => JSONWebKeySet, calls: { count: number }, options: Partial<ConstructorParameters<typeof RemoteJwksHandoffVerifier>[0]> = {}) {
  return new RemoteJwksHandoffVerifier({
    jwksUrl,
    issuer,
    audience,
    algorithms: ["RS256"],
    maximumLifetimeSeconds: 120,
    fetch: responder(jwks, calls),
    ...options,
  });
}

describe("Phase 11.6 remote JWKS hand-off verification", () => {
  it("validates an asymmetric signature and all required issuer/audience/time/identity claims, using cached keys", async () => {
    const identity = await signer("key-one");
    const calls = { count: 0 };
    const remote = verifier(() => identity.jwks, calls);
    const first = await remote.verify(await handoff(identity.privateKey, identity.kid), now);
    const second = await remote.verify(await handoff(identity.privateKey, identity.kid, { nonce: "nonce-synthetic-jwks-11-6-second" }), now);
    expect(first).toMatchObject({ patientReference: "pat_eu_jwks_11_6", issuer, emailHash: "d".repeat(64) });
    expect(second.nonce).toContain("second");
    expect(calls.count).toBe(1);
  });

  it("rejects malformed, unsigned/symmetric, wrong-signature, wrong-audience, expired, future-not-before, and incomplete hand-offs without leaking details", async () => {
    const identity = await signer("key-one");
    const attacker = await signer("key-one");
    const calls = { count: 0 };
    const remote = verifier(() => identity.jwks, calls);
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "none", kid: "key-one" })).toString("base64url")}.${Buffer.from("{}").toString("base64url")}.`;
    await expect(remote.verify("not-a-jwt", now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(remote.verify(unsigned, now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(remote.verify(await handoff(attacker.privateKey, attacker.kid), now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(remote.verify(await handoff(identity.privateKey, identity.kid, { audience: "wrong-audience" }), now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(remote.verify(await handoff(identity.privateKey, identity.kid, { expiresAt: Math.floor(now.getTime() / 1_000) - 1 }), now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(remote.verify(await handoff(identity.privateKey, identity.kid, { notBefore: Math.floor(now.getTime() / 1_000) + 61 }), now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(remote.verify(await handoff(identity.privateKey, identity.kid, { emailHash: null }), now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(remote.verify(await handoff(identity.privateKey, identity.kid, { emailHash: "D".repeat(64) }), now)).rejects.toBeInstanceOf(HandoffRejectedError);
    await expect(remote.verify(await handoff(identity.privateKey, identity.kid, { patientReference: "pat_123" }), now)).rejects.toBeInstanceOf(HandoffRejectedError);
  });

  it("refreshes a matching key after a configured rotation without accepting an unapproved algorithm", async () => {
    const first = await signer("key-one");
    const second = await signer("key-two");
    let current = first.jwks;
    const calls = { count: 0 };
    const remote = verifier(() => current, calls, { cooldownMilliseconds: 0 });
    await expect(remote.verify(await handoff(first.privateKey, first.kid), now)).resolves.toMatchObject({ issuer });
    current = second.jwks;
    await expect(remote.verify(await handoff(second.privateKey, second.kid, { nonce: "nonce-synthetic-jwks-11-6-rotated" }), now)).resolves.toMatchObject({ issuer });
    expect(calls.count).toBe(2);
    expect(() => new RemoteJwksHandoffVerifier({ jwksUrl, issuer, audience, algorithms: ["HS256"], maximumLifetimeSeconds: 120 })).toThrow(HandoffRejectedError);
  });

  it("fails closed when JWKS retrieval is unavailable or times out", async () => {
    const identity = await signer("key-one");
    const unavailable = new RemoteJwksHandoffVerifier({
      jwksUrl, issuer, audience, algorithms: ["RS256"], maximumLifetimeSeconds: 120,
      fetch: async () => { throw new Error("synthetic unavailable JWKS"); },
    });
    await expect(unavailable.verify(await handoff(identity.privateKey, identity.kid), now)).rejects.toBeInstanceOf(HandoffRejectedError);
    const timeout = new RemoteJwksHandoffVerifier({
      jwksUrl, issuer, audience, algorithms: ["RS256"], maximumLifetimeSeconds: 120, timeoutMilliseconds: 10,
      fetch: async (_url, options) => new Promise<Response>((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("synthetic timeout")), { once: true })),
    });
    await expect(timeout.verify(await handoff(identity.privateKey, identity.kid), now)).rejects.toBeInstanceOf(HandoffRejectedError);
  });

  it("requires the complete future contract and otherwise keeps the runtime verifier fail-closed", () => {
    expect(handoffVerifierFromEnvironment({})).toBeInstanceOf(UnconfiguredJwksHandoffVerifier);
    expect(handoffVerifierFromEnvironment({ PH7_HANDOFF_JWKS_URL: jwksUrl, PH7_HANDOFF_ISSUER: issuer, PH7_HANDOFF_AUDIENCE: audience, PH7_HANDOFF_ALLOWED_ALGORITHMS: "HS256", PH7_HANDOFF_MAX_TTL_SECONDS: "120" })).toBeInstanceOf(UnconfiguredJwksHandoffVerifier);
    expect(handoffVerifierFromEnvironment({ PH7_HANDOFF_JWKS_URL: jwksUrl, PH7_HANDOFF_ISSUER: issuer, PH7_HANDOFF_AUDIENCE: audience, PH7_HANDOFF_ALLOWED_ALGORITHMS: "RS256", PH7_HANDOFF_MAX_TTL_SECONDS: "120" })).toBeInstanceOf(RemoteJwksHandoffVerifier);
    expect(handoffVerifierFromEnvironment({ PH7_HANDOFF_JWKS_URL: "https://app.ph7.health/api/v1/referral/jwks", PH7_HANDOFF_ISSUER: "https://app.ph7.health", PH7_HANDOFF_AUDIENCE: "ph7-referral-engine", PH7_HANDOFF_ALLOWED_ALGORITHMS: "ES256", PH7_HANDOFF_MAX_TTL_SECONDS: "300" })).toBeInstanceOf(RemoteJwksHandoffVerifier);
  });
});
