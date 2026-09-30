# Local Operations and Production Readiness

## Current staging mode

The isolated Vercel project `ph7-referral-growth-engine` uses the dedicated Referral Growth Engine PostgreSQL/Supabase database. Preview review mode is explicit: `APP_ENV=preview` and `REFERRAL_DEMO_MODE=true` must both be configured. Demo mode seeds and reads synthetic records only, and it never creates a real pH7, GA4, banking, payment, DNS, or patient-data connection.

## Future environment requirements

Provide a dedicated non-production then production PostgreSQL/Supabase database; apply migrations only to that dedicated database. The exact future server-only variables are `REFERRAL_DATABASE_URL`, `PH7_WEBHOOK_SECRET` (rotatable HMAC key), `PH7_HANDOFF_JWKS_URL`, `PH7_HANDOFF_ISSUER`, `PH7_HANDOFF_AUDIENCE`, `PH7_HANDOFF_ALLOWED_ALGORITHMS`, `PH7_HANDOFF_MAX_TTL_SECONDS`, `PAYOUT_DATA_ENCRYPTION_KEY`, `ADMIN_SESSION_SECRET`, and `PATIENT_SESSION_SECRET`. Never place these in `NEXT_PUBLIC_*`, commit them, or use the local fallback webhook secret in a deployed environment.

Phase 11.2B initialized the dedicated Referral Growth Engine database through its Session Pooler after an empty-schema identity check. Migrations `0001` then `0002` are applied there. Do not rerun `db:apply` against that initialized database; future migrations must be newly numbered, reviewed, and applied through an explicit authorised step. No existing pH7, landing-page, Vercel, or database project is in scope.

For Phase 11.2B, do not shell-source a dotenv file containing a database URL: URL characters can be interpreted by the shell. Use the repository's `db:identity`, `db:apply`, `db:verify`, and `test:database` commands, which load the value through Next's dotenv parser and keep it out of command arguments and diagnostics. If identity or isolation verification fails, stop before migration application.

If `db:identity` reports that the database host cannot be resolved, do not substitute a different project or alter DNS. Obtain a reachable direct or pooler endpoint for the same already-isolated database, update only its ignored local environment value, and repeat Step 11.2B from identity verification.

The current database checks are `db:verify`, `test:database`, and `test:database:concurrency`. They use no patient or financial production data. The standard integration test rolls back all fixtures. The concurrency test removes its randomly scoped fixtures in a locked transaction that restores both immutable triggers before commit; `db:verify` confirms no Step 11.2B fixture remains.

Step 11.3 adds `test:database:persistence`, which exercises the real Node PostgreSQL adapter and pool reinitialisation with a random synthetic attribution fixture. Server routes select database attribution persistence only when `REFERRAL_DATABASE_URL` is present; local synthetic adapters remain restricted to the unauthenticated development portal/admin/simulator surfaces. The connection string is server-only and must never be committed or exposed through `NEXT_PUBLIC_*`.

`lib/runtime/production-actions.ts` is the future-authentication-ready server action boundary for campaign/settings, payout, fraud, and audit operations. It requires PostgreSQL; production-configured persistence must never fall back to `LocalReferralEngine`.

## Phase 11.4 authentication operation

Migration `0003_phase11_authentication_foundation.sql` is applied to the dedicated Referral Growth Engine database. Do not rerun `db:apply`; `db:apply:auth` is retained for a newly provisioned, otherwise identical isolated database only. Verify the existing database with `npm run db:verify`; it must report 16 expected tables/indexes and the Step 11.2B fixture count of zero. `npm run test:database:auth` uses only a random synthetic patient reference, HMAC test secret, issuer, nonce, and session values; it concurrently consumes one hand-off nonce, reinitialises the PostgreSQL pool, verifies CSRF/session invalidation, and removes its scoped records.

At runtime, `ADMIN_SESSION_SECRET` and `PATIENT_SESSION_SECRET` must be independently generated high-entropy values of at least 32 characters and must remain server-only. Changing either secret deliberately invalidates that subject's extant sessions because only HMAC token digests are stored; schedule the change, communicate required reauthentication, then rotate and monitor rejected-session volume. Session cookies are Secure in production, HTTP-only, SameSite=Lax, path-scoped, and expiry-bound. Mutating routes/actions must validate the corresponding CSRF value and resolve the actor from the HTTP-only session, never from form data or JSON.

At the end of Phase 11.4, `PH7_HANDOFF_JWKS_URL` and `PH7_HANDOFF_ISSUER` were interface/configuration placeholders only. Step 11.6 later added the adapter described below; until the complete approved contract is configured, hand-off verification still rejects requests generically. `PH7_WEBHOOK_SECRET` is also required for a database-configured webhook route; missing it rejects the event rather than falling back to synthetic state.

## Phase 11.6 signed hand-off operation

The confirmed pH7 hand-off values are non-secret and may be configured on the isolated preview: `PH7_HANDOFF_JWKS_URL=https://app.ph7.health/api/v1/referral/jwks`, `PH7_HANDOFF_ISSUER=https://app.ph7.health`, `PH7_HANDOFF_AUDIENCE=ph7-referral-engine`, `PH7_HANDOFF_ALLOWED_ALGORITHMS=ES256`, and `PH7_HANDOFF_MAX_TTL_SECONDS=300`. Configure all five together or the verifier remains fail-closed. If pH7 PR #1524 has not deployed the signing key or JWKS is unavailable, real hand-off still fails closed and should be reported as a pH7-side dependency.

The hand-off must be a compact JWS JWT with protected `kid`/`alg`, standard `iss`, `aud`, integer `iat` and `exp`, optional `nbf`, and the minimal referral claims `patient_reference`, `email_hash`, `nonce`, `issued_at`, and `expires_at`. `patient_reference` must preserve the region prefix shape such as `pat_eu_123`; `email_hash` must be lowercase SHA-256 hex. The ISO dates must match `iat`/`exp` exactly. No browser-provided identity field is accepted by `/auth/handoff` or `/api/auth/handoff`; each accepts only the token, returns a generic 401 on any failure, and creates an HTTP-only referral session only after JWKS verification and a serializable one-time nonce transaction.

At runtime the remote JWKS cache is process-local (ten-minute freshness, 30-second missing-key cooldown, five-second fetch timeout). Key rotation therefore requires publishing the next public key at the configured JWKS URL before issuing tokens under its new `kid`; retain prior keys for the agreed overlap. No JWKS URL, issuer, audience, algorithm, TTL, token, key, or secret belongs in logs, HTML, client code, committed configuration, or `NEXT_PUBLIC_*` variables. The Step 11.6 tests use generated keys and synthetic identities only; they do not call a pH7 endpoint.

## Phase 11.5 isolated preview operation

The local repository link is `ph7-dispensarys-projects/ph7-referral-growth-engine` only. Its current deployment-protected preview URL is `https://ph7-referral-growth-engine-dz2u00k7o-ph7-dispensarys-projects.vercel.app`. Do not use `--prod`, configure a custom domain, edit DNS, or connect Git deployment automation as part of this preview workflow. Create a new preview with `npx vercel deploy --target preview --yes --scope ph7-dispensarys-projects` from this repository root. Inspect it with `npx vercel inspect <preview-url> --scope ph7-dispensarys-projects`; use `npx vercel curl` for protected smoke requests rather than disabling deployment protection.

Preview-scoped Vercel secrets are `REFERRAL_DATABASE_URL`, `ADMIN_SESSION_SECRET`, `PATIENT_SESSION_SECRET`, and `PH7_WEBHOOK_SECRET`. The review preview also has non-secret demo flags `APP_ENV=preview` and `REFERRAL_DEMO_MODE=true`, confirmed pH7 hand-off values, `PH7_PATIENTS_URL=https://patients.ph7.health`, and optional `PH7_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS=300`. `REFERRAL_PUBLIC_URL` may remain unset on Vercel because runtime uses Vercel's deployment URL automatically; set it only when a stable approved referral domain exists. Add/rotate values only with `vercel env add`/`vercel env update` against this project and the `preview` environment; never use `--value` with a visible secret, shell-source a dotenv file, or print values. Preview has no GA4, banking/payment, DNS, custom-domain, or production-pH7 database/application configuration.

Before each deploy, run `npm run db:identity`, `npm run db:verify`, `npm run validate`, `npm run test:database`, `npm run test:database:concurrency`, `npm run test:database:persistence`, `npm run test:database:auth`, and `npm run build`. The new Vercel project must have the **Next.js** framework preset and Next.js default output directory; if a fresh project shows `Other`/`public`, correct only this isolated project's framework setting before retrying. No migration application, database reset, or real-data seed is part of preview deployment.

`npm run db:ensure-staging-demo` idempotently prepares synthetic review records for `PH7DEMO`, the patient portal, payouts, fraud flags, and audit history in the dedicated database. It preserves the active programme unless a future authenticated demo UI deliberately creates a new campaign version. Run it solely for staging validation. Smoke test `/`, `/portal`, unauthenticated `/admin` protection, `/integration`, `/r/PH7DEMO`, `/r/INVALID1`, unsigned `POST /api/webhooks/ph7`, and malformed `POST /api/auth/handoff`; inspect only statuses/assertions, never raw secret-containing data.

`npm run db:ensure-preview-fixture` is retained for the older `PREVIEW11` smoke path. Prefer `PH7DEMO` for review.

Rollback is preview-only: deploy the prior known-good revision explicitly to `--target preview`, or remove only the failed preview deployment from this new project after preserving needed diagnostics. Never promote a preview, modify `landingpage`, or touch an existing pH7 project's aliases, domains, environments, or deployments.

## Production runbook requirements

Before launch: define database backups and restore testing; PII/IBAN retention/deletion policy; audit-log retention; webhook retry and alerting policy; secret rotation; rate limits/WAF; incident ownership; and monitoring/alerting for webhook failures, payout queue backlog, ledger/reconciliation mismatches, and fraud-review backlog. Test the disaster-recovery path against a non-production copy before any launch.
