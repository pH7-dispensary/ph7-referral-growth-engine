# Security Specification

## Trust boundaries

The public funnel treats all browser values as untrusted. The patient portal trusts only verified short-lived hand-offs. The webhook trusts only a verified signature, timestamp/replay policy, schema, and unique event ID. Founder actions require separate role-based admin authentication.

## Required controls

- Verify pH7 hand-off signature, issuer/audience, `iat`/`issued_at`, `exp`/`expires_at`, optional `nbf`, and single-use nonce before issuing a Referral Engine session.
- Never recreate or access the pH7 PIN/password system; use only `patient_reference`, `email_hash`, temporal claims, and nonce.
- Verify webhook signatures over the raw request body using a rotated secret strategy; reject malformed, stale, or unverifiable payloads.
- Validate every payload schema server-side; rate-limit public endpoints and escape/validate redirect targets.
- Store secrets exclusively in environment configuration; never commit them or expose them to browser bundles.
- Encrypt/tokenise IBAN data at rest, restrict its access, and never place raw values in logs/audit metadata.
- Minimise PII. Store hashes/references where possible; set retention and deletion rules before production.
- Authorise every portal, admin, payout, and fraud action on the server. Add CSRF-safe mutation patterns and secure cookies.
- Record security-relevant actions and webhook failures with redaction.

## Phase 11.4 controls

- Referral sessions are opaque random values; PostgreSQL retains only an HMAC digest, expiry, revocation state, CSRF-token digest, and exactly one server-side subject. Patient and admin session secrets are separate.
- The database enforces single-use hand-off nonces through a primary-key HMAC hash. Claiming a nonce, resolving/creating the minimal referral user, and creating a patient session occur in one serializable transaction.
- Local HMAC hand-off signing exists exclusively for synthetic test/development fixtures and cannot be constructed in production. The future JWKS verifier is fail-closed until its separately authorised pH7 contract is implemented.
- Production pages and actions derive identity/role from an HTTP-only session. Development synthetic portal/admin access is available only when `NODE_ENV === "development"`; test/production paths cannot use it.
- Database-configured webhook verification uses a raw-body HMAC helper and a server-only future secret; it does not instantiate or consult synthetic local state.

## Phase 11.6 hand-off verifier controls

- `RemoteJwksHandoffVerifier` accepts only configured public-key JWS algorithms (`RS*`, `PS*`, `ES*`, `EdDSA`/`Ed25519`). HMAC, unsigned, malformed, and algorithm-confused tokens are rejected before session creation.
- `jose` verifies the compact JWS signature against the exact HTTPS JWKS endpoint and validates configured issuer, audience, expiry, not-before, issued-at age, and all required identity claims. The adapter also requires the legacy ISO temporal claims to match the signed standard JWT time claims exactly.
- Keys are cached per warm runtime for ten minutes. An unknown `kid` may refresh only after the 30-second cooldown, allowing normal rotation without creating an unbounded refresh path. JWKS retrieval times out after five seconds and every verification/retrieval failure returns the same generic hand-off rejection.
- The configured policy is all-or-nothing: `PH7_HANDOFF_JWKS_URL`, `PH7_HANDOFF_ISSUER`, `PH7_HANDOFF_AUDIENCE`, `PH7_HANDOFF_ALLOWED_ALGORITHMS`, and `PH7_HANDOFF_MAX_TTL_SECONDS` must all be valid before a remote verifier can be constructed. Missing or incomplete configuration has no network side effect and remains fail-closed.
- This is a verification adapter only. It does not access pH7 data, create pH7 traffic, or replace the database-backed nonce/session controls. A real hand-off is still blocked until a separately authorised pH7 contract provides the precise values and sender-side implementation.

## Development safety

Development impersonation and event simulation are enabled only outside production, clearly marked, gated by an explicit development secret, and unavailable from production builds.

## Staging demo safety

The review environment is available only when both `APP_ENV=preview` and `REFERRAL_DEMO_MODE=true` are configured. Demo mode seeds and reads synthetic PostgreSQL records, but it does not infer authentication from missing production configuration. Real pH7 hand-off remains fail-closed, unsigned webhooks remain rejected, and no pH7, GA4, DNS, banking, payment, or real patient system is connected.
