import "server-only";

import { createHmac } from "node:crypto";
import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify, type FetchImplementation, type JWSAlgorithm, type RemoteJWKSet } from "jose";
import { hmacDigest, secureEqual } from "@/lib/auth/crypto";
import type { HandoffTokenVerifier, VerifiedPatientHandoff } from "@/lib/auth/types";

const approvedPublicKeyAlgorithms = new Set<JWSAlgorithm>([
  "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA", "Ed25519",
]);
const defaultClockToleranceSeconds = 30;
const defaultJwksCacheMaxAgeMilliseconds = 10 * 60 * 1_000;
const defaultJwksCooldownMilliseconds = 30 * 1_000;
const defaultJwksTimeoutMilliseconds = 5 * 1_000;

export class HandoffRejectedError extends Error {
  constructor(readonly reason = "HANDOFF_REJECTED") { super("The hand-off could not be verified."); }
}

interface JwtHeader { alg?: unknown; typ?: unknown; }
interface JwtClaims {
  iss?: unknown;
  patient_reference?: unknown;
  email_hash?: unknown;
  issued_at?: unknown;
  expires_at?: unknown;
  nonce?: unknown;
}

type RemoteJwksOptions = {
  readonly jwksUrl: string;
  readonly issuer: string;
  readonly audience: string;
  readonly algorithms: readonly JWSAlgorithm[];
  readonly maximumLifetimeSeconds: number;
  readonly clockToleranceSeconds?: number;
  readonly cacheMaxAgeMilliseconds?: number;
  readonly cooldownMilliseconds?: number;
  readonly timeoutMilliseconds?: number;
  readonly fetch?: FetchImplementation;
};
type HandoffEnvironment = Readonly<Record<string, string | undefined>>;

function decodeSegment(segment: string): unknown {
  try { return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")); } catch { throw new HandoffRejectedError("MALFORMED_JWT_SEGMENT"); }
}

function readDate(value: unknown): Date {
  if (typeof value !== "string") throw new HandoffRejectedError("INVALID_ISO_DATE_CLAIM");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new HandoffRejectedError("INVALID_ISO_DATE_CLAIM");
  return date;
}

function readBounded(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max || /[\u0000-\u001f]/.test(value)) throw new HandoffRejectedError("INVALID_STRING_CLAIM");
  return value;
}

function datesMatchNumericJwtClaim(value: Date, numericClaim: unknown): boolean {
  return typeof numericClaim === "number" && Number.isSafeInteger(numericClaim) && value.getTime() === numericClaim * 1_000;
}

function parsePositiveInteger(value: string | undefined, maximum: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
}

function parseAlgorithms(value: string | undefined): readonly JWSAlgorithm[] | null {
  if (!value) return null;
  const algorithms = value.split(",").map((algorithm) => algorithm.trim());
  if (!algorithms.length || algorithms.some((algorithm) => !approvedPublicKeyAlgorithms.has(algorithm as JWSAlgorithm))) return null;
  return [...new Set(algorithms)] as JWSAlgorithm[];
}

function validIssuerOrAudience(value: string | undefined): value is string {
  return Boolean(value && value.length <= 512 && !/[\u0000-\u001f]/.test(value));
}

function validJwksUrl(value: string | undefined): value is string {
  if (!value || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

const patientReferencePattern = /^pat_[a-z]{2}_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const sha256LowercaseHexPattern = /^[a-f0-9]{64}$/;

export function validateHandoffClaims(claims: JwtClaims, issuer: string, now: Date, maximumLifetimeSeconds = 600): VerifiedPatientHandoff {
  if (claims.iss !== issuer) throw new HandoffRejectedError("ISSUER_MISMATCH");
  const patientReference = readBounded(claims.patient_reference, 3, 160);
  if (!patientReferencePattern.test(patientReference)) throw new HandoffRejectedError("PATIENT_REFERENCE_FORMAT");
  const emailHash = readBounded(claims.email_hash, 64, 64);
  if (!sha256LowercaseHexPattern.test(emailHash)) throw new HandoffRejectedError("EMAIL_HASH_FORMAT");
  const nonce = readBounded(claims.nonce, 16, 256);
  const issuedAt = readDate(claims.issued_at);
  const expiresAt = readDate(claims.expires_at);
  const issued = issuedAt.getTime();
  const expires = expiresAt.getTime();
  const current = now.getTime();
  const skew = defaultClockToleranceSeconds * 1_000;
  if (issued > current + skew) throw new HandoffRejectedError("ISSUED_AT_IN_FUTURE");
  if (expires <= current) throw new HandoffRejectedError("EXPIRED_HANDOFF");
  if (expires <= issued) throw new HandoffRejectedError("INVALID_HANDOFF_WINDOW");
  if (expires - issued > maximumLifetimeSeconds * 1_000) throw new HandoffRejectedError("HANDOFF_TTL_TOO_LONG");
  return { patientReference, emailHash, issuer, issuedAt, expiresAt, nonce };
}

function verifiedRemoteClaims(payload: Record<string, unknown>, issuer: string, now: Date, maximumLifetimeSeconds: number): VerifiedPatientHandoff {
  const verified = validateHandoffClaims(payload as JwtClaims, issuer, now, maximumLifetimeSeconds);
  if (!datesMatchNumericJwtClaim(verified.issuedAt, payload.iat)) throw new HandoffRejectedError("ISSUED_AT_IAT_MISMATCH");
  if (!datesMatchNumericJwtClaim(verified.expiresAt, payload.exp)) throw new HandoffRejectedError("EXPIRES_AT_EXP_MISMATCH");
  return verified;
}

/**
 * Strict, public-key-only verifier for the future pH7 contract. It accepts
 * only configured asymmetric algorithms and trusts keys fetched from the exact
 * HTTPS JWKS URL. The database remains responsible for consuming the nonce.
 */
export class RemoteJwksHandoffVerifier implements HandoffTokenVerifier {
  private readonly keys: RemoteJWKSet;
  private readonly clockToleranceSeconds: number;

  constructor(private readonly options: RemoteJwksOptions) {
    if (!validJwksUrl(options.jwksUrl) || !validIssuerOrAudience(options.issuer) || !validIssuerOrAudience(options.audience)
      || !options.algorithms.length || options.algorithms.some((algorithm) => !approvedPublicKeyAlgorithms.has(algorithm))
      || !Number.isSafeInteger(options.maximumLifetimeSeconds) || options.maximumLifetimeSeconds < 1 || options.maximumLifetimeSeconds > 600) {
      throw new HandoffRejectedError("INVALID_HANDOFF_CONFIGURATION");
    }
    this.clockToleranceSeconds = options.clockToleranceSeconds ?? defaultClockToleranceSeconds;
    if (!Number.isSafeInteger(this.clockToleranceSeconds) || this.clockToleranceSeconds < 0 || this.clockToleranceSeconds > 60) throw new HandoffRejectedError("INVALID_CLOCK_TOLERANCE");
    this.keys = createRemoteJWKSet(new URL(options.jwksUrl), {
      timeoutDuration: options.timeoutMilliseconds ?? defaultJwksTimeoutMilliseconds,
      cooldownDuration: options.cooldownMilliseconds ?? defaultJwksCooldownMilliseconds,
      cacheMaxAge: options.cacheMaxAgeMilliseconds ?? defaultJwksCacheMaxAgeMilliseconds,
      ...(options.fetch ? { [customFetch]: options.fetch } : {}),
    });
  }

  async verify(token: string, now = new Date()): Promise<VerifiedPatientHandoff> {
    try {
      if (!token || token.length > 8_192) throw new HandoffRejectedError("TOKEN_LENGTH");
      const header = decodeProtectedHeader(token);
      if (!header.kid || typeof header.kid !== "string" || header.kid.length > 128) throw new HandoffRejectedError("MISSING_OR_INVALID_KID");
      if (!approvedPublicKeyAlgorithms.has(header.alg as JWSAlgorithm) || !this.options.algorithms.includes(header.alg as JWSAlgorithm)) throw new HandoffRejectedError("UNAPPROVED_ALGORITHM");
      const result = await jwtVerify(token, this.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: [...this.options.algorithms],
        maxTokenAge: this.options.maximumLifetimeSeconds,
        clockTolerance: this.clockToleranceSeconds,
        currentDate: now,
        requiredClaims: ["exp", "iat", "patient_reference", "email_hash", "nonce", "issued_at", "expires_at"],
      });
      return verifiedRemoteClaims(result.payload, this.options.issuer, now, this.options.maximumLifetimeSeconds);
    } catch (error) {
      if (error instanceof HandoffRejectedError) throw error;
      const reason = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? `JWT_${error.code.replace(/[^A-Z0-9_]/gi, "_").toUpperCase()}`
        : "JWT_VERIFY_FAILED";
      throw new HandoffRejectedError(reason);
    }
  }
}

/**
 * Loads the explicit pH7 contract without contacting its JWKS endpoint. An
 * absent/incomplete contract stays fail-closed, so a deployment cannot accept
 * real hand-offs just because a single variable was set accidentally.
 */
export function handoffVerifierFromEnvironment(environment: HandoffEnvironment = process.env): HandoffTokenVerifier {
  const jwksUrl = environment.PH7_HANDOFF_JWKS_URL;
  const issuer = environment.PH7_HANDOFF_ISSUER;
  const audience = environment.PH7_HANDOFF_AUDIENCE;
  const algorithms = parseAlgorithms(environment.PH7_HANDOFF_ALLOWED_ALGORITHMS);
  const maximumLifetimeSeconds = parsePositiveInteger(environment.PH7_HANDOFF_MAX_TTL_SECONDS, 600);
  if (!validJwksUrl(jwksUrl) || !validIssuerOrAudience(issuer) || !validIssuerOrAudience(audience) || !algorithms || !maximumLifetimeSeconds) {
    return new UnconfiguredJwksHandoffVerifier(jwksUrl, issuer);
  }
  return new RemoteJwksHandoffVerifier({ jwksUrl, issuer, audience, algorithms, maximumLifetimeSeconds });
}

/**
 * Test/development verifier. It is a real HS256 verification path, but is
 * intentionally prohibited in production; production must inject a JWKS-backed
 * verifier once that pH7 contract has been approved.
 */
export class LocalHmacHandoffVerifier implements HandoffTokenVerifier {
  constructor(
    private readonly options: { readonly secret: string; readonly issuer: string; readonly environment?: string; readonly maximumLifetimeSeconds?: number },
  ) {
    if ((options.environment ?? process.env.NODE_ENV) === "production") throw new HandoffRejectedError("LOCAL_VERIFIER_DISABLED_IN_PRODUCTION");
  }

  async verify(token: string, now = new Date()): Promise<VerifiedPatientHandoff> {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !part || !/^[A-Za-z0-9_-]+$/.test(part))) throw new HandoffRejectedError("MALFORMED_LOCAL_JWT");
    const header = decodeSegment(parts[0]) as JwtHeader;
    if (header.alg !== "HS256" || header.typ !== "JWT") throw new HandoffRejectedError("LOCAL_JWT_HEADER_REJECTED");
    const expected = createHmac("sha256", this.options.secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
    if (!secureEqual(expected, parts[2])) throw new HandoffRejectedError("LOCAL_SIGNATURE_REJECTED");
    return validateHandoffClaims(decodeSegment(parts[1]) as JwtClaims, this.options.issuer, now, this.options.maximumLifetimeSeconds);
  }
}

/** Deliberately fail-closed when the complete pH7 hand-off contract is absent. */
export class UnconfiguredJwksHandoffVerifier implements HandoffTokenVerifier {
  constructor(readonly jwksUrl: string | undefined, readonly issuer: string | undefined) {}
  async verify(_token: string): Promise<VerifiedPatientHandoff> { throw new HandoffRejectedError("UNCONFIGURED_JWKS_VERIFIER"); }
}

/** Synthetic helper used only by tests; never read from environment or routes. */
export function signTestHandoff(claims: Omit<VerifiedPatientHandoff, "issuedAt" | "expiresAt"> & { issuedAt: Date; expiresAt: Date }, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: claims.issuer, patient_reference: claims.patientReference, email_hash: claims.emailHash, issued_at: claims.issuedAt.toISOString(), expires_at: claims.expiresAt.toISOString(), nonce: claims.nonce })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function handoffNonceHash(secret: string, nonce: string): string { return hmacDigest(secret, `handoff-nonce:${nonce}`); }
