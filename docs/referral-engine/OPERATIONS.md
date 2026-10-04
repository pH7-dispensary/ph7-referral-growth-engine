# Local Operations and Production Readiness

## Founder password access — authorised 2026-10-03

Use `https://refer.ph7.health/admin/login`. The form is publicly reachable but has no public registration and reveals no configured username/password; all admin content remains session/role protected. `ADMIN_LOGIN_CREDENTIAL` is sensitive and production-scoped, with JSON `{version:1,emailHash,salt,passwordHash}`; emailHash is normalized-email SHA-256, salt is 16 random bytes as hex, passwordHash is 64-byte scrypt as hex using N=131072/r=8/p=1. Provision only through an approved private procedure with CLI stdin or a secret manager. Never store a plaintext password, publish the verifier, expose a NEXT_PUBLIC variable or put credentials in documentation. Existing session secrets are unchanged. Password updates require deliberate configuration/redeployment and a separate session-revocation plan; changing the verifier alone does not revoke existing opaque sessions.

POST login enforces the canonical production Origin, fixed redirects and 4096-byte form limits. A PostgreSQL-backed single-founder throttle allows at most 12 attempts per 15 minutes across all serverless instances; invalid attempts and successful attempts both consume a slot. It uses the existing append-only `admin_audit_log` with no submitted identity or password. During a lockout, wait for the window; do not delete immutable audit records or bypass authentication. Admin logout is POST-only and CSRF protected and does not end patient sessions. Unauthenticated `/admin` redirects to `/admin/login` only when valid founder configuration exists; otherwise it remains unavailable. Admin responses must be no-store and non-indexable. Credentials establish founder access only: production operational dashboard composition is still pending. No public signup, MFA or password-reset service is added by this change.

To rerun restart/concurrency authentication tests, use `PH7_LOCAL_ADMIN_INTEGRATION=true npx vitest run tests/admin-login-postgres.test.ts` with only the disposable loopback PostgreSQL instance at port 55473/database `ph7_release_test`; the harness overrides its URL and uses synthetic credentials. It never loads production credentials or database configuration. Keep its immutable audit fixtures local and stop the test server after verification.

Founder login is deployed at `/admin/login`: application commit `a77a406`, READY deployment `dpl_9FZbB9tsp3wYgFs5SWqBDUmpCDfX`. The real authorised account successfully authenticated in production; protected access, secure cookie flags, logout and session revocation passed with assertion-only output. Verification left no active smoke session. The empty public login form is accessible, while credentials are sensitive/server-only and admin data remains protected. The operational dashboard is not yet composed. Existing patient credentials/session secrets, payout storage configuration and all financial records were untouched.

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

Before each deploy, run `npm run db:identity`, `npm run db:verify`, `npm run validate`, `npm run test:database`, `npm run test:database:concurrency`, `npm run test:database:persistence`, `npm run test:database:auth`, `npm run test:e2e:referral`, and `npm run build`. The new Vercel project must have the **Next.js** framework preset and Next.js default output directory; if a fresh project shows `Other`/`public`, correct only this isolated project's framework setting before retrying. No migration application, database reset, or real-data seed is part of preview deployment.

`npm run db:ensure-staging-demo` idempotently prepares synthetic review records for `PH7DEMO`, the patient portal, payouts, fraud flags, and audit history in the dedicated database. It preserves the active programme unless a future authenticated demo UI deliberately creates a new campaign version. Run it solely for staging validation. Smoke test `/`, `/portal`, unauthenticated `/admin` protection, `/integration`, `/r/PH7DEMO`, `/r/INVALID1`, unsigned `POST /api/webhooks/ph7`, and malformed `POST /api/auth/handoff`; inspect only statuses/assertions, never raw secret-containing data.

`npm run db:ensure-preview-fixture` is retained for the older `PREVIEW11` smoke path. Prefer `PH7DEMO` for review.

Rollback is preview-only: deploy the prior known-good revision explicitly to `--target preview`, or remove only the failed preview deployment from this new project after preserving needed diagnostics. Never promote a preview, modify `landingpage`, or touch an existing pH7 project's aliases, domains, environments, or deployments.

## Production runbook requirements

Before launch: define database backups and restore testing; PII/IBAN retention/deletion policy; audit-log retention; webhook retry and alerting policy; secret rotation; rate limits/WAF; incident ownership; and monitoring/alerting for webhook failures, payout queue backlog, ledger/reconciliation mismatches, and fraud-review backlog. Test the disaster-recovery path against a non-production copy before any launch.

## Public production operation — refer.ph7.health

Production deployment target: dedicated Vercel project `ph7-dispensarys-projects/ph7-referral-growth-engine`. Do not use or modify `landingpage` or any other Vercel project. The production deployment uses the same dedicated Referral Engine PostgreSQL/Supabase database; never reset it and never seed real patient data for smoke tests.

Server-only production environment must contain: `REFERRAL_DATABASE_URL`, `ADMIN_SESSION_SECRET`, `PATIENT_SESSION_SECRET`, `PH7_WEBHOOK_SECRET`, `PH7_HANDOFF_JWKS_URL`, `PH7_HANDOFF_ISSUER`, `PH7_HANDOFF_AUDIENCE`, `PH7_HANDOFF_ALLOWED_ALGORITHMS`, `PH7_HANDOFF_MAX_TTL_SECONDS`, `PH7_PATIENTS_URL`, `REFERRAL_PUBLIC_URL`, `PH7_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS`, `APP_ENV=production`, and `REFERRAL_DEMO_MODE=false`. None belong in `NEXT_PUBLIC_*`.

`npm run test:e2e:referral` is the safe automated referral lifecycle E2E. It creates unique synthetic referrer/friend identifiers, exercises PostgreSQL-backed attribution, webhook qualification, reward ledger, payout request/mark-paid, refund reversal, fraud review, duplicate/idempotency paths, and database integrity checks inside one transaction that rolls back at the end.

Every successful production patient hand-off must leave the session's `referral_user_id` with exactly one active referral code. The Referral Engine issues this in the same PostgreSQL transaction that consumes the hand-off nonce and creates the patient session; repeated/concurrent valid hand-offs for the same patient must preserve the existing active code. If `/portal` loads but does not show a code/link, check `referral_codes` for that `referral_user_id`, then rerun `npm run test:database:auth` before deploying a fix. Do not create public/patient-supplied codes or accept referral-code values from the browser hand-off.

`refer.ph7.health` is attached to the Vercel project, but registrar DNS must point the subdomain to Vercel before the public domain resolves. Required DNS at the provider:

```text
type: CNAME
name: refer
value: 9f9d85e7e8a6ee99.vercel-dns-016.com.
```

If the DNS provider cannot use that CNAME, Vercel also accepts:

```text
type: A
name: refer
value: 76.76.21.21
```

After DNS changes, run `npx vercel domains verify refer.ph7.health --scope ph7-dispensarys-projects`, then smoke test `https://refer.ph7.health` directly.

The production webhook secret is generated and stored in Vercel as `PH7_WEBHOOK_SECRET`. Because Vercel stores it hidden, do not attempt to read or expose it. If pH7 has not yet received the same value through an approved private channel, rotate the Referral Engine production secret during a secure live handoff and provide the value to the pH7 developer only through that approved channel. pH7 must configure it as `REFERRAL_WEBHOOK_SECRET` and send webhooks to `https://refer.ph7.health/api/webhooks/ph7`.

Before joint E2E payment testing, confirm externally: `[ ] Viva Source 3671 Active and linked to pH7`.

## Patient portal review operation

The production `/portal` page is authenticated by the existing patient session and reads only server-derived `referral_user_id` scope. It does not accept patient identity, referral user IDs, or economics from the browser.

Current offer values displayed in the hero/share copy come from the active campaign and programme settings. Reward cards come from `reward_ledger`; do not reconcile or "fix" portal balances in UI code. If the portal shows no offer, verify that one campaign is active and programme settings are enabled before changing code.

Patient withdrawal requests now use the existing PostgreSQL payout account/request infrastructure through a session-scoped, CSRF-checked server action. The action is exposed only when `PAYOUT_DATA_ENCRYPTION_KEY` is valid. Missing/invalid configuration leaves online withdrawal unavailable and does not collect bank details. Manual/admin payout operations remain the source of truth for actual payment and Mark Paid.

For a portal UI release, run `npm run lint`, `npm run typecheck`, `npm run validate:migrations`, `npm run test:run`, and `npm run build`. If database read-model behavior changes, also run the PostgreSQL persistence/auth suites against only the dedicated Referral Growth Engine database. Never use real patient data for screenshots or smoke tests.

## Final UI release safety — 2026-10-03

Production `/integration` is no longer an exposed developer-review surface in the prepared release. It is available in local development or explicitly enabled preview demo mode only; `APP_ENV=production` or `VERCEL_ENV=production` always makes it unavailable. `/dev/interaction-review` is development-only. Verify both routes return 404 after releasing the prepared commit. Production referral origins are restricted to `https://refer.ph7.health`; a missing configured origin uses that canonical domain, while an explicitly wrong production origin fails closed. Do not change campaign economics or secrets to troubleshoot presentation.

When production financial test fixtures are forbidden, run the integration suites against an isolated temporary local PostgreSQL instance, not the production URL. Create a unique `/private/tmp` data directory with `initdb`, bind PostgreSQL to loopback on port 55473, and create only the disposable database `ph7_release_test`. Apply unchanged migrations 0001–0003 to that local instance; initialise its own clearly synthetic campaign/settings. Supply its local-only connection through the child test process environment, never by editing the production dotenv or Vercel environment. Run `db:verify`, `test:database`, `test:database:concurrency`, `test:database:persistence`, `test:database:auth`, `test:e2e:referral`, and `NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-portal-read-model.ts --isolated-local`. The read-model option requires that exact loopback host, port and database; it does not relax the dedicated Supabase target check for ordinary runs. Stop the temporary server afterwards. Do not run concurrency fixture cleanup (which temporarily disables immutable triggers) on a production database for UI QA.

Verify the dedicated production database with read-only schema queries only. Never reset/seed it, create synthetic financial/referral records there, apply migrations there as part of this UI release, rotate secrets or inspect session-token/cookie values. Local screenshots with localhost links are explicitly synthetic and are not evidence of the deployed referral URL.

Before completing release, use a normally authenticated existing pH7 account in the browser to exercise the approved `/auth/handoff/start` flow. Inspect the actual rendered invitation URL (not merely environment configuration), active-offer copy, rewards, referral activity and masked payout history. Do not fabricate a production patient session to bypass this check. If no authenticated browser session is available, obtain a normal signed-in pH7-to-Refer session from the user and hold the release rather than claiming success. Do not push main while the gate is blocked because Git deployment automation may release it automatically.

On 2026-10-03 the prepared final UI release passed all local tests, local PostgreSQL suites and rendered desktop/mobile QA, but remained held pending authenticated production browser verification. Existing production was inspected read-only and was not redeployed; its staging `/integration` exposure remains until the prepared fix is released.

On 2026-10-03, after being informed that both available browsers lacked authenticated production portal access, the user explicitly authorised deployment with “yes it's fine deploy”. This authorises this release despite that outstanding authenticated-browser gate; it does not count as verification of the real patient handoff, live patient-scoped campaign/reward UI or sessions. Retain those checks as post-release follow-up. Deploy only the linked `ph7-referral-growth-engine` project, preserving its production environment, database and domains. Public read-only smoke checks must not create patient, attribution or financial fixtures.

## Patient cash withdrawal configuration and verification — 2026-10-03

The cash/withdrawal update passed local release validation and the user explicitly authorised production publication and Git push after disclosure of the missing local encryption configuration and physical-iPhone/authenticated-production testing limits. Publication does not constitute verification of a real authenticated patient flow. `PAYOUT_DATA_ENCRYPTION_KEY` must be a securely generated 32-byte AES key, represented as 64 hexadecimal characters or canonical 44-character base64 with one trailing `=`. Configure it only through an explicitly authorised private secret-management procedure for the dedicated Referral Engine environment. Never print, commit, log or document its value. No secret was created, changed or inspected beyond an existence check in this task; local configuration was MISSING. Do not rotate an existing key without an approved encrypted-account migration/key-retention plan.

`lib/portal/payout-encryption.ts` uses a version-1 AES-256-GCM envelope (version byte, 12-byte random IV, 16-byte authentication tag, ciphertext) in the existing `payout_accounts.iban_encrypted` column. AAD binds it to `payout-account:<referral_user_id>`. The decrypt function is a server-only operational seam, not a browser action or permission grant. Manual operators must use an authorised secure workflow; this update does not add banking-provider access or automated transfers. Account holder names remain in the existing access-controlled name column; patient DTOs return only account ID and masked last four characters, never raw IBAN or encryption material.

The authenticated form confirms a masked saved account or submits new holder/IBAN details. Replacing details creates a new encrypted account attached atomically to the new payout request, preserving old requests' destinations. Requests use the existing shared serializable repository path, session-derived owner, CSRF validation, idempotency keys, programme minimum, fraud-review gating and outstanding-request reservations. They do not post a ledger debit. Manual Mark Paid appends exactly one debit, atomically with status/audit changes; it rejects inactive requests and debit-key collisions rather than silently claiming payment. Only sanitized status/message/mask is returned to the browser. Failed/replayed submissions cannot create orphan accounts or duplicate debits.

Run the additional local integration test with `PH7_LOCAL_CASH_INTEGRATION=true npx vitest run tests/patient-cash-postgres.test.tsx`, or enable that flag for all Vitest tests. The harness forcibly uses only `127.0.0.1:55473/ph7_release_test`, never loads production dotenv, and generates its own temporary test-only encryption key. It preserves rendered UI assertions and verifies actual admin offer changes, snapshots, balances, encrypted account updates, patient isolation, fraud review, reservations, concurrent requests/Mark Paid, restarts and reversal. Its committed clearly synthetic fixtures stay only in the disposable local test database; stop the loopback instance after testing and never run this fixture workflow against production. No schema migration is required.

Production release completed on 2026-10-03: commit `0b21ad3`, deployment `dpl_9xXsrghKeR6TeQuNLWPJq2v8PniN`, READY at `https://refer.ph7.health`. Code was pushed only to the dedicated Referral Engine repository. Local validation, 125 tests, local and remote builds, public protection checks and desktop/mobile entry smoke tests passed. No production database test writes or configuration changes were made. Authenticated handoff, patient-scoped cash UI and physical-iPhone navigation need a normal signed-in user retest; no production session was fabricated. Production encryption-key availability was not verified, and online withdrawal stays unavailable if it is missing/invalid. Actual payment remains manual.

The subsequent Back to pH7 control release is commit `f075677`, deployed READY as `dpl_3CZjYN1e4ymFdsLMXqxhuY4EmXf9` to the same production URL. It links directly to `https://app.ph7.health/` without ending the Refer session. Public protection smoke checks passed. This publication did not configure/rotate payout encryption or enable an admin identity provider; both configuration/access follow-ups remain separate. Device-specific native app reopening and authenticated production return require a normal user retest.

## Patient return correction — prepared locally, not published

The next prepared control corrects that historical wrong destination to `https://patients.ph7.health/en/home`. Keep this return URL fixed, without authentication/identity parameters and without Refer logout. Do not change `PH7_HANDOFF_ISSUER` or redemption URLs: they serve a different security boundary.

Read-only checks on 2026-10-03: Patient home returns 200 without redirect; Android and Apple `.well-known` association files return 200 JSON without redirects. Android delegates `handle_all_urls` to `app.ph7`; Apple names `69F2T3M9C4.app.pH7.user` and currently includes all paths. Native entitlements, release certificate matches, intent filters, URL handlers and Refer browser presentation remain unverified because the native source is not available here. No association configuration was changed.

Before claiming native return works, obtain the actual Patient native repository path and preserve its VNext modifications. Inspect its Refer browser launch and supported dismissal API; validate the real signing IDs and OS association configuration. If native configuration/handlers change, build and release the relevant app. Limit AASA routes appropriately in its owning repository after inspecting supported routes. Test installed/uninstalled app cases, authenticated/expired Refer sessions, repeated open/close, iOS Safari and the actual in-app container, Android Chrome and redirect-loop absence. A successful desktop HTTPS navigation or an association file alone is not a native-return test. The local correction passed lint/typecheck/static migration validation, 141 tests with two opt-in DB tests skipped, build and responsive browser navigation. Do not deploy/push this change without explicit approval.

## Founder password retrieval and rotation

The production founder password is not recoverable from Vercel: Vercel contains only `ADMIN_LOGIN_CREDENTIAL`, a server-only versioned email hash, random salt and scrypt password verifier. The current retrievable password is stored locally in macOS Keychain under service `ph7-referral-growth-engine-admin` and account `oska@ph7.health`. An authorised founder can retrieve it locally with macOS Passwords/Keychain Access, or run `security find-generic-password -a oska@ph7.health -s ph7-referral-growth-engine-admin -w` directly in their own Terminal. Never capture that command's output in support logs, chat, screenshots, shell history, documentation or source control.

Safari Private Browsing may submit the login/logout form with opaque `Origin: null`. Accept it only when the server request URL is exactly `https://refer.ph7.health` and Fetch Metadata is exactly `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: navigate`, and `Sec-Fetch-Dest: document`. Never accept an opaque origin with absent/altered metadata or a noncanonical request URL. Keep generic invalid-credential UI, durable throttling, body limits, secure HTTP-only SameSite cookies and session-bound logout CSRF unchanged.

The production correction is commit `58294ad`, deployed READY as `dpl_KLcp2vzgC88MDP9MBBtD7MRy14ZF`. The post-rotation browser check must cover login, authenticated refresh, logout, direct unauthenticated `/admin`, and absence of registration routes. The 2026-10-03 check passed all five; `/admin/signup` and `/admin/register` returned 404. Do not exercise the production rate limit to prove it operational; rely on the serializable PostgreSQL tests and monitor sanitized denial categories.

## Founder operations

The production founder console reads only the dedicated Referral Engine PostgreSQL database. Overview totals and balances are derived from referrals, `reward_ledger`, payout requests and fraud flags; GMV/revenue metrics remain absent until a trusted value is added to the signed event contract. Patient and friend references are masked for display. Audit rendering allowlists operational metadata and excludes secrets, credentials, hashes, tokens, signatures, cookies and bank details.

Campaign publication creates a new version for future attribution. Before saving, verify the displayed old/new friend incentive, referrer cash reward, holding period and active status; the confirmation is not a substitute for financial review. Never update historical referral economics directly. Payout operators must complete and independently verify the manual bank transfer before using Mark Paid. Mark Paid records the ledger debit and payout state atomically; do not use it to initiate or simulate a transfer.

Release checks must include authenticated Overview/Campaigns/Referrals/Payouts/Fraud/Audit navigation, refresh persistence, logout and unauthenticated denial. Use the development-only `/dev/founder-dashboard` fixture for responsive screenshots; it is unavailable in production. Use only the disposable loopback `ph7_release_test` database for write/concurrency/snapshot tests. Production smoke testing must remain read-only unless the founder explicitly intends a real operational change.

## Production cutover controls — 2026-10-04

Production must use `APP_ENV=production` and `REFERRAL_DEMO_MODE=false`. `VERCEL_ENV=production` is an independent code-level deny boundary for demo mode. Never configure `REFERRAL_DATABASE_URL`, `PH7_WEBHOOK_SECRET`, `PATIENT_SESSION_SECRET` or `ADMIN_SESSION_SECRET` for preview deployments unless preview has its own isolated database and credentials. Preview currently has none of those production values.

`PAYOUT_DATA_ENCRYPTION_KEY` is configured only in the dedicated production Vercel project. Treat it as persistent financial encryption material: never print, pull, log, commit or rotate it without retaining the old key for existing ciphertext or performing an approved re-encryption migration. Real payouts remain manual: the patient request stores encrypted bank details and reserves balance; the founder transfers externally, verifies the transfer and then uses Mark Paid to append the single ledger debit.

The one-time cleanup command is intentionally guarded and should not be rerun as routine maintenance. First run it without `--apply` and inspect only the sanitized count manifest. Applying requires `PRODUCTION_CUTOVER_CONFIRM=REMOVE_CONFIRMED_SYNTHETIC_DATA` and a `CUTOVER_MANIFEST_PATH`. It refuses unclassified identifiers and preserves webhook/handoff/campaign history. After cutover, the expected matching count for every cleanup category is zero. Never broaden its predicates, add a blanket delete or use it for genuine patient/financial erasure.

Production campaign version 2 is the active €10 friend / €10 referrer / zero-day offer. Version 1 stays inactive because immutable attribution history references it. New campaign publication must continue through the founder/domain action so old attribution/referral economics remain unchanged. Until the pH7 backend consumes a signed friend-incentive snapshot contract, changing the friend incentive in Refer also requires holding the campaign change and releasing the matching pH7 checkout configuration; otherwise the landing offer and charged discount can diverge. The current pH7 production checkout value is €10 and matches version 2.

Webhook events must include the existing signed `patient_reference` and `consultation_reference` fields. Missing/invalid fields are rejected before processing. Verified self-referral, duplicate patient and duplicate consultation identities are serialized with transaction-scoped locks, recorded as deterministic fraud flags and cannot create credit before review. Same-device, suspicious-IP and velocity controls require trustworthy signed signals before automation; do not infer or fabricate them.

Post-cutover verification is read-only except for deliberate real operations: run `npm run db:identity`, `npm run db:verify`, `npm run validate`, `npm run build`, then public protection/smoke checks. `npm run test:e2e:referral` is safe against the dedicated database only because it encloses every fixture and transition in one explicit transaction and always rolls back; confirm its final output says `rolled_back=true`. The last unavoidable live proof is a genuine eligible friend using a real patient's link and completing a real qualifying payment. Record only privacy-safe correlation identifiers, then verify signed delivery, one referral, one credit and the resulting withdrawal eligibility. Never synthesize a paid event in production.
