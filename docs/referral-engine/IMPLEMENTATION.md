# Implementation Plan

Status: **Phases 0–10 and Phase 11.1–11.6 complete, plus staging review mode.** The standalone repository is locally linked only to the isolated Vercel project `ph7-dispensarys-projects/ph7-referral-growth-engine`. The former local `landingpage` linkage was replaced only after explicit authorisation; no existing pH7/Vercel project was modified. No pH7 system, external integration, production credential, custom domain, or production deployment has been connected.

## Phase 0 — Repository and environment isolation

Acceptance: a dedicated standalone repository exists; its root and no-touch boundaries are documented; no other repository is modified; there is no production environment or database connection. The GitHub remote and local Vercel link are explicitly user-authorised references only; neither permits remote changes or deployment.

## Phase 1 — Architecture and specifications

Acceptance: product, architecture, database, state, security, events, and implementation specs exist; ownership boundaries and pending pH7 contracts are explicit; implementation has not started.

## Phase 2 — Database and domain foundation

Acceptance: **satisfied without a database connection.** An isolated Next.js 16 + TypeScript foundation is present. `db/migrations/0001_phase2_referral_engine.sql` is a PostgreSQL 15+/Supabase-compatible, unapplied migration defining the Phase 2 domain: referral users/codes, campaigns/settings, attributions and referral economics snapshots, referrals/events, reward ledger, payout accounts/requests, fraud flags, admin users/audit log, and webhook event receipts.

Key decisions and safeguards:

- Monetary values are signed integer minor units in EUR. `reward_ledger` is append-only, uses an idempotency key, constrains credit/debit signs, and has an immutable-history trigger. It is the future balance source of truth.
- Referral attribution and referral records hold copied economics/version fields. A database trigger rejects referral snapshot mutation; current campaign/settings values therefore cannot silently change historical economics.
- Both the server-side lifecycle service and a database trigger validate the permitted state transitions. Every service transition appends a unique-idempotency referral event.
- `QualificationService` performs lifecycle qualification and its corresponding credit within one transaction boundary. It is the shared service future manual and webhook adapters must call.
- `EventIngestionService` claims the unique external `event_id` before processing. All adapters remain future interfaces only—there is no webhook route, hand-off, analytics, payout transfer, authentication, database client, or live credential.

Tests and validation created:

- `tests/domain.test.ts` covers valid and invalid transitions, fraud-review restoration, immutable historical snapshots, duplicate concurrent lifecycle operations, duplicate concurrent financial postings, shared qualification, and duplicate event ingestion (8 passing tests).
- `scripts/validate-migrations.ts` statically checks that the migration contains core tables, unique event/financial keys, and ledger/state/snapshot safeguards. It passed.
- `npm run lint`, `npm run typecheck`, `npm run validate`, and `npm run build` all passed on 2026-09-23. The migration has deliberately not been applied because no dedicated local/test PostgreSQL or Supabase database has been authorised/provisioned.

Remaining risks and Phase 3 boundary: a dedicated non-production database must be provisioned and the migration applied/tested there before user-facing data flows exist. Phase 3 may add only development-gated patient impersonation and portal UI on top of these services; it must not add live pH7 hand-off, webhooks, GA4, bank transfers, production authentication, production database access, or deployment.

## Phase 3 — Patient referral portal

Acceptance: **satisfied with synthetic local data only.** `app/page.tsx` provides the portal entry screen and `app/portal/page.tsx` provides a dynamic, cookie-gated dashboard. The responsive portal includes the current reward, personal referral code/URL, generated QR code, native-share/copy affordances, how-it-works copy, available/pending/lifetime balances, referral activity and patient-safe status text, withdrawal entry, masked payout history, loading/success/error form states, and mobile-first styling.

Important implementation decisions:

- `lib/portal/data.ts` is a synthetic server-side read model, not a database client. It derives balances from ledger entries and historical referral rewards from the relevant immutable `EconomicsSnapshot`; the UI never references a mutable global reward setting.
- `lib/portal/status.ts` converts existing Phase 2 lifecycle states into patient language only. No UI component can mutate the lifecycle.
- `lib/portal/dev-access.ts` permits synthetic access only when `NODE_ENV === "development"`; production and test modes cannot enable it. `lib/portal/dev-actions.ts` is a separate Server Action that creates an HTTP-only, same-site, one-hour development session cookie. The sole identity is clearly labelled synthetic test data.
- `lib/portal/referral-link.ts` validates codes and produces a local referral URL; `lib/portal/qr.ts` generates its QR SVG on the server. There is no live acquisition hand-off.
- `lib/portal/actions.ts` validates withdrawal input server-side. Account-holder name and IBAN are never placed in URLs, browser storage, logs, analytics, or response messages; Phase 3 discards them after validation. `lib/portal/payout.ts` normalises/validates IBAN checksum data and exposes only a masked display value. No payout request, ledger debit, bank account, or bank transfer is persisted/created until Phase 6.

Tests and validation added:

- `tests/portal.test.tsx` covers referral information rendering, immutable historical economics display, patient-safe status presentation, referral-link/QR generation, development-mode isolation, IBAN masking/checksum validation, and invalid payout amounts/account data.
- The complete test suite has 15 passing tests across 2 files, including all Phase 2 domain tests.
- `npm run lint`, `npm run typecheck`, `npm run validate:migrations`, `npm run test:run`, and `npm run build` passed on 2026-09-23.
- A local browser verification exercised the entry screen, anonymous redirect, development-only synthetic session, portal UI, and synthetic payout-form success state with no error overlay. The temporary server was stopped afterward.

Remaining integration requirements and production boundary: Phase 3 uses no real patient, financial, or database data. A future signed pH7 hand-off must replace—not weaken—the development session. A dedicated test database and encrypted persistence are required before real payout-account data or payout requests exist. Do not add pH7 authentication, database access, live referral redirects, GA4, payment/banking providers, webhooks, Vercel changes, or deployment in Phase 3.

## Phase 4 — Referred friend funnel

Acceptance: **satisfied with local synthetic attribution only.** `app/r/[code]` is a dynamic server-rendered friend-invitation route and `app/r/continue` is its safe local hand-off confirmation. The funnel validates the code on the server, resolves a synthetic active campaign, presents only the friend incentive, and explains the offer in patient-friendly language. It never exposes a referral-user ID or referrer identity.

Attribution architecture:

- `lib/funnel/attribution.ts` is server-only and owns validation, campaign availability, immutable economics capture, opaque attribution generation, and idempotency. It creates IDs as `attr_` plus cryptographically random UUID material; the identifier is non-sequential and contains no code, patient, referrer, campaign, or economics data.
- An HTTP-only, same-site synthetic journey cookie provides the idempotency context. The CTA resolves the existing attribution for the same journey/code or creates exactly one new record; concurrent attempts are serialized. The opaque attribution ID is then kept in a separate HTTP-only cookie and resolved server-side by `/r/continue`.
- The synthetic in-memory store deliberately models the dedicated database’s `referral_attributions` constraint boundary while the database is not authorised. It survives local development hot reload through `globalThis`, but a process restart clears synthetic data. A future repository adapter must persist the same fields/unique context key to the dedicated PostgreSQL database.
- Economics are snapshotted from the resolved campaign at creation through the existing immutable `EconomicsSnapshot`. The friend incentive and referrer reward remain in that record, so later campaign/settings changes cannot alter historical attribution economics. No ledger entry or reward is created in Phase 4.

Friend journey and local continuation:

1. A visitor opens `/r/[code]`; only the server validates the code/campaign and renders the friend-safe offer.
2. The visitor chooses **Continue to pH7**; the Server Action creates/resolves local attribution and carries its opaque ID in an HTTP-only cookie.
3. `/r/continue` confirms the local hand-off and displays the opaque reference. It does not redirect to, call, or link to a live pH7 domain.

Invalid and unavailable states are intentional, polished views for malformed, unknown, inactive, expired, inactive-offer, and unavailable invitations. They contain no internal error, database, campaign, or referrer detail.

Tests and validation added:

- `tests/funnel.test.tsx` covers valid/malformed/unknown/inactive/expired/inactive-offer handling, opaque ID shape, no referrer leakage, concurrent idempotency, immutable attribution economics, friend incentive rendering, and safe local continuation without a production URL.
- The full suite has 23 passing tests across 3 files, including all Phase 2 and Phase 3 tests.
- `npm run lint`, `npm run typecheck`, `npm run validate:migrations`, `npm run test:run`, and `npm run build` passed on 2026-09-23.
- Local browser verification passed for the valid friend offer, local opaque hand-off confirmation, and expired invitation state with no framework error overlay. The temporary server was stopped afterward.

Remaining production integration requirements and boundary: Phase 4 has no production persistence, signing, pH7 acquisition URL, GA4, webhook, or external redirect. Before launch, replace synthetic code/campaign resolution and the in-memory store with the dedicated database repository; define the signed hand-off/allowed destination contract; pass only the opaque `attribution_id`; and add consent-aware analytics. Do not modify pH7, the landing page, Vercel, DNS, production systems, or external services in Phase 4.

## Phase 5 — Founder admin

Acceptance: **satisfied locally.** `/admin` has development-only founder access via an HTTP-only synthetic session. Its Overview, Economics, Campaigns, Referrals, Payouts, Fraud, and Audit sections use server actions and the shared local engine. Economics controls version the current campaign while historical referral snapshots remain unchanged. Every mutation writes a local audit event.

## Phase 6 — Reward ledger and payouts

Acceptance: **satisfied locally.** `LocalReferralEngine` provides append-only credit, payout, and reversal posting with idempotency keys. Balances are calculated from effective ledger entries; there is no mutable balance field. Synthetic withdrawal requests enter a manual queue, and Mark Paid creates exactly one negative payout ledger entry plus audit event. IBANs remain masked synthetic values only. No automated transfer exists.

## Phase 7 — pH7 conversion webhook and manual qualification

Acceptance: **satisfied locally.** `POST /api/webhooks/ph7` validates raw JSON schema, verifies HMAC SHA-256 signature, idempotently claims event IDs, applies controlled transitions, then calls the same engine qualification path as founder manual qualification. It handles paid and refunded events, creates/reverses reward ledger entries, audits results, and returns generic safe errors. `POST /api/dev/webhook` is development-only and signs local test payloads; it is unavailable outside development. No pH7 call is made.

## Phase 8 — Fraud controls

Acceptance: **satisfied locally.** The shared fraud model supports the documented deterministic flag vocabulary, with founder flag/review/approve/reject/investigate flows and audit records. Open flags move a referral into `FRAUD_REVIEW` and prevent automatic qualification; resolving review restores or rejects through the authoritative local engine. No ML scoring exists.

## Phase 9 — Analytics

Acceptance: **satisfied locally.** `lib/local/analytics.ts` defines every required behavioural event behind a no-network adapter that records only local synthetic events. Founder reporting derives referral count, qualified count, active referrers, reward spend, and outstanding liability from local domain/ledger state. GA4 is neither configured nor contacted.

## Phase 10 — Testing, security, and hardening

Acceptance: **satisfied for local scope.** The suite covers attribution validity/idempotency/opacity, immutable historical economics, legal/illegal lifecycle transitions, duplicate paid webhook protection, refunds/reversals, payout idempotency and balance effects, fraud holds, shared manual/webhook qualification behaviour, invalid signatures and malformed payload safety, synthetic admin isolation, payout masking/validation, and no-network analytics. Server-only boundaries protect attribution, cookie, analytics, and local engine modules; client responses do not expose sensitive errors. `OPERATIONS.md` records required production backups, retention, secret rotation, rate limits, monitoring, and incident/recovery planning.

Validation: `npm run lint`, `npm run typecheck`, `npm run validate:migrations`, `npm run test:run` (34 passing tests), and `npm run build` passed on 2026-09-23. Local browser verification passed for development founder access and its responsive overview. The temporary server was stopped.

Remaining boundary: all persistence is synthetic/in-process, including the clean `AttributionStore` local adapter. The future PostgreSQL adapter must implement the same interfaces and transactional uniqueness constraints before any real launch. Required future integration contracts are signed pH7 hand-off, production webhook secret rotation/retries, dedicated database/migration application, encrypted payout-account storage, real admin/patient authentication, consent-aware GA4 adapter, and an explicitly authorised isolated deployment. Do not begin Phase 11 without those approvals.

## Phase 11.1 — Dedicated database readiness

Acceptance: **complete locally; no database has been created or contacted.** This step inspected the Phase 2–10 migration, domain services, local engine, and `AttributionStore`. The original schema already covered referral users/codes, referrals/state events, campaign/settings economics, ledger, payouts, fraud, audits, and webhook idempotency. Three production-boundary gaps were corrected in the new, unapplied `db/migrations/0002_phase11_database_readiness.sql`:

- `referral_attributions.public_id` is a unique, checked opaque `attr_<32 lowercase hex>` identifier. The internal UUID remains private.
- `journey_context_hash` is unique and stores only a one-way idempotency-context hash; migration backfill uses an internal legacy marker. The actual journey value must never be persisted.
- Attribution history is immutable via the existing append-only trigger, and `reward_ledger` now permits only one `PAYOUT` debit for each payout request.

`lib/persistence/postgres.ts` introduces an injected, driver-neutral `SqlExecutor` and `PostgresAttributionRepository`. Its parameterized `INSERT ... ON CONFLICT (journey_context_hash)` implementation is transaction-scoped and returns the prior record for a concurrent duplicate. It has no database driver, URL, credential, client creation, or network side effect. A future composition root—not UI/API code—must inject a real PostgreSQL/Supabase executor and add matching repositories for lifecycle, ledger, payout, webhook, fraud, campaign, and audit workflows. Financial writes must use database transactions/locking and all state changes must still invoke the authoritative domain services.

Validation: `npm run lint`, `npm run typecheck`, `npm run validate:migrations`, `npm test`, and `npm run build` passed locally on 2026-09-23 (36 tests). Static validation is not a substitute for applying migrations to a dedicated disposable test database; therefore the schema is **not yet production-ready for deployment** until Step 11.2 provisions an isolated database, applies both migrations there, and runs integration/restore/concurrency testing.

### Exact future database deployment procedure (do not perform in Step 11.1)

1. Create a **new, isolated** Supabase/PostgreSQL project named for the Referral Growth Engine; do not select, link, import, or reuse any pH7, landing-page, or existing database project.
2. Obtain a least-privileged direct PostgreSQL connection string for server migrations/runtime. Set it only in the isolated project’s protected environment as `REFERRAL_DATABASE_URL`; never expose it with a `NEXT_PUBLIC_` prefix.
3. In a dedicated disposable test database first, run the migration tool that executes `0001_phase2_referral_engine.sql` followed by `0002_phase11_database_readiness.sql` in lexical order. Record the migration checksums and verify the expected tables, triggers, indexes, and constraints.
4. Configure the future server runtime only with `REFERRAL_DATABASE_URL`, `PH7_WEBHOOK_SECRET`, `PH7_HANDOFF_JWKS_URL`, `PH7_HANDOFF_ISSUER`, `PAYOUT_DATA_ENCRYPTION_KEY`, `ADMIN_SESSION_SECRET`, and `PATIENT_SESSION_SECRET`. Supply real pH7 hand-off values only after their contract is authorised; this step neither requests nor uses them.
5. Implement/inject the remaining PostgreSQL repositories, run database integration tests including concurrent duplicate webhook/payout operations and restore testing, then separately seek approval before any deployment, external connection, or migration application.

## Phase 11.2B — Dedicated database initialisation

Acceptance: **satisfied for dedicated database initialisation only.** A credential-redacting connection through the dedicated Supabase Session Pooler succeeded. Before mutation, the target reported the default Supabase database name, zero public tables, and zero referral-engine tables/indexes/triggers; combined with the explicitly provisioned isolated project, this established the permitted target boundary.

The reviewed migrations were applied once, in lexical order and separate PostgreSQL transactions:

- `0001_phase2_referral_engine.sql` — SHA-256 `162c20a4e4a418f7c7f4369f603bd07fcbdee105b026826ef8925acfdd41079e`
- `0002_phase11_database_readiness.sql` — SHA-256 `2f83b92a1eb2dd119682ed1ccb89f86e508a0f5717e76e0b20fad9cd3ef2cc28`

Actual catalog verification passed: 14 expected public tables, 14 expected named indexes, 13 expected triggers, 14 primary keys, 15 foreign keys, 12 unique constraints, the opaque-attribution check constraint, and the immutable-ledger trigger. No Step 11.2B synthetic fixture remained after testing.

The repository now contains credential-safe local commands: `npm run db:identity`, `npm run db:apply`, `npm run db:verify`, `npm run test:database`, and `npm run test:database:concurrency`. `scripts/referral-database.ts` parses the local environment without shell-sourcing it, passes discrete libpq variables to `psql` instead of a connection-string command argument, and redacts connection diagnostics. PostgreSQL integration tests use synthetic values only: the standard suite rolls back economics/state/idempotency/append-only checks, while the concurrent suite verifies that simultaneous attribution creation produces one durable winner and simultaneous payout debits produce one durable winner. Its scoped fixture cleanup locks both immutable tables and disables only their named user triggers inside one transaction, reenabling both before commit; it never leaves either trigger disabled.

Validation on 2026-09-24: `npm run db:verify`, `npm run test:database`, `npm run test:database:concurrency`, `npm run lint`, `npm run typecheck`, `npm run validate:migrations`, `npm run test:run` (36 passing tests), and `npm run build` all passed.

No pH7 system, Vercel project, GA4 property, DNS, payment/banking system, or other database was contacted or modified. This does not connect application routes to the new database and does not authorise deployment.

## Phase 11.3 — PostgreSQL server persistence boundary

Acceptance: **partially satisfied without deployment or external-system integration.** `pg` is now a server-only dependency. `lib/persistence/node-postgres.ts` creates a bounded Node PostgreSQL pool only when `REFERRAL_DATABASE_URL` is configured, executes serializable transactions, and never logs the URL. `lib/persistence/domain-postgres.ts` implements the existing `TransactionRunner`/`ReferralRepository` contract for locked referral reads, controlled status writes/events, idempotent ledger writes, and webhook event claiming. Webhook claiming now returns whether the insert actually acquired the unique event; this prevents a concurrent conflict from running a duplicate handler.

`DatabaseAttributionService` reads referral codes, campaigns, and enabled settings from PostgreSQL, captures the existing immutable economics snapshot, hashes journey context, and uses the unique database context key for idempotency. The server funnel routes/actions select this database service whenever `REFERRAL_DATABASE_URL` is present; without it, existing synthetic adapters remain for automated tests and unconfigured local development. A driver-level persistence test creates only a random synthetic user/code/campaign/settings/attribution, reinitializes the pool/repository, confirms retrieval, and removes the scoped fixture in one locked cleanup transaction that restores the immutable trigger before commit.

Validation on 2026-09-24: lint, typecheck, static migration validation, 36 automated tests, PostgreSQL schema verification, standard PostgreSQL integrity tests, concurrent attribution/payout tests, runtime persistence/reinitialization test, and production build passed. No schema migration was required.

The development-only portal/admin screens and development webhook simulator intentionally retain their synthetic data because they are unauthenticated local-test tools; they are not production persistence paths. Phase 11.4 adds a fail-closed production authentication boundary around those surfaces without connecting a real identity provider or pH7.

## Phase 11.4 — Authentication and authorization foundation

Acceptance: **satisfied locally, without an external identity-provider or pH7 connection.** Migration `0003_phase11_authentication_foundation.sql` adds two dedicated-database tables: `referral_auth_sessions`, for expiring/revocable opaque browser sessions, and `referral_handoff_nonces`, for atomic single-use hand-off nonce consumption. Both store only HMAC/hash material for browser/session/replay tokens. The session-subject check permits exactly one subject—either a referral user or an admin—for every stored session; token hashes are unique and active-session/nonce-expiry indexes support safe server lookups and cleanup.

`lib/auth/` provides the server-only interfaces and implementations. `LocalHmacHandoffVerifier` performs genuine HS256 validation solely in test/development and throws in production. `UnconfiguredJwksHandoffVerifier` declares the future `PH7_HANDOFF_JWKS_URL`/`PH7_HANDOFF_ISSUER` contract but deliberately fails closed: it makes no remote call and never accepts a token. Signature, issuer, issued-at, expiry, maximum lifetime, malformed token, and nonce requirements are validated before the PostgreSQL transaction that consumes the nonce, resolves/creates the minimal referral user, and persists the session. Raw hand-off tokens, raw nonces, secrets, and credentials are never logged or stored.

Patient and admin session cookies are HTTP-only, SameSite=Lax, path-scoped, expiry-bound, high-priority, and Secure in production. Separate non-HTTP-only CSRF cookies carry an opaque double-submit value whose HMAC is verified on server-side mutations. `ADMIN_SESSION_SECRET` and `PATIENT_SESSION_SECRET` are independent and required at runtime; missing/short secrets cause authentication to fail closed. Session invalidation is persisted and works after pool/repository reinitialisation.

`/portal` now uses only its server-derived patient session outside development and queries only that session's referral-user scope. `/admin` is deliberately not exposed to an unauthenticated production request; development keeps its explicitly `NODE_ENV === development` synthetic console, while non-development requests require a persisted admin session and role. `lib/runtime/admin-server-actions.ts` resolves the admin actor from the HTTP-only session, and `lib/runtime/production-actions.ts` refuses null/roleless actors before calling the existing PostgreSQL operational repository. Admin audit records now accept the resolved server-side actor/request context rather than browser-provided identity. The production-configured webhook route now validates its raw-body HMAC without consulting `LocalReferralEngine`, and has no non-development in-memory fallback.

Validation on 2026-09-24: `npm run lint`, `npm run typecheck`, `npm run validate:migrations`, `npm run test:run` (42 tests), `npm run db:verify`, and `npm run test:database:auth` passed. The database test used random synthetic claims and exercised concurrent nonce replay (one winner), invalid signature/claim handling, CSRF validation, persisted invalidation, and pool/repository reinitialisation. It removed all scoped fixtures. Migration `0003` was applied only to the already-verified dedicated Referral Growth Engine database; its catalog now has 16 expected tables, 16 expected named indexes, 13 expected triggers, 16 primary keys, 17 foreign keys, and 13 unique constraints.

Remaining boundary: the real pH7 issuer/key-discovery/algorithm/audience contract and the independent founder identity provider are not yet authorised or connected. A future adapter must implement those existing interfaces, define JWKS cache/rotation and issuer/audience policy, and create sessions only after provider verification. Do not add pH7 access, Vercel deployment, GA4, DNS, banking/payment providers, or a production identity provider in this phase.

## Phase 11.5 — Isolated Vercel preview deployment

Acceptance: **satisfied for an isolated preview only.** A new Vercel project named `ph7-referral-growth-engine` was created under `ph7-dispensarys-projects` and this repository's local `.vercel/project.json` now links exclusively to it. The ready preview deployment is `https://ph7-referral-growth-engine-oz346l9e6-ph7-dispensarys-projects.vercel.app`; it has no custom domain and is deployment-protected. No production target was used for the ready deployment.

The new project's preview environment contains only server-side secrets: `REFERRAL_DATABASE_URL` for the pre-existing dedicated Referral Growth Engine PostgreSQL database, fresh independent `ADMIN_SESSION_SECRET` and `PATIENT_SESSION_SECRET` values, and a fresh `PH7_WEBHOOK_SECRET`. `PH7_HANDOFF_JWKS_URL` and `PH7_HANDOFF_ISSUER` remain absent, so real pH7 hand-off requests fail closed. No GA4, banking/payment, DNS, custom-domain, or real-patient configuration exists. The database was re-identified and catalog-verified before deployment: migrations `0001`–`0003` remain applied, with 16 expected tables/indexes, 13 triggers, 16 primary keys, 17 foreign keys, and 13 unique constraints.

The first new-project build exposed an isolated configuration defect: Vercel had created the project with the `Other` framework preset and a static `public` output expectation. Only the new project's preset was changed to Next.js; an explicit preview-target redeployment then reached `READY`. The original failed build was never promoted or assigned a domain.

Remote smoke testing used Vercel's protected deployment request mechanism without disabling deployment protection. It verified: home `200`; unauthenticated `/admin` `404`; unauthenticated `/portal` `307`; invalid referral `200` with safe unavailable copy; synthetic `PREVIEW11` referral `200` with the PostgreSQL-backed offer; unconfigured hand-off `401`; unsigned webhook `400`; and zero checked secret markers in every response body. `PREVIEW11` is an idempotently seeded, clearly synthetic database fixture with no patient identity; it is available only to make preview validation repeatable. The browser-automation binary was unavailable in this local environment, so viewport screenshots were not captured; protected HTTP response and deployment-error-log checks passed, with no error-level logs after smoke tests.

Validation on 2026-09-24: database identity/schema verification; lint; typecheck; static migration validation; 42 unit tests; PostgreSQL integrity, concurrency, runtime-restart, and authentication restart/replay tests; and local/remote Next.js builds passed. The deployment procedure and rollback boundary are documented in `OPERATIONS.md`. This does not authorise Step 11.6 or any real pH7 integration.

## Phase 11.6 — Signed patient hand-off adapter

Acceptance: **satisfied as a disabled, production-quality verification boundary; no pH7 connection has been enabled.** `lib/auth/handoff.ts` now contains `RemoteJwksHandoffVerifier`, a public-key-only compact-JWS verifier built on `jose`. It validates the exact configured HTTPS JWKS endpoint, issuer, audience, approved asymmetric algorithm allow-list, JWT `iat`/`exp`/optional `nbf`, maximum token age, protected `kid`, required minimal identity claims, and matching legacy ISO time claims. Retrieval failures, timeouts, bad keys, malformed tokens, wrong claims, and all unconfigured cases fail with the same generic hand-off rejection.

The runtime composition root caches the verifier only per warm server process, enabling JWKS caching and controlled missing-key refresh while keeping configuration server-only. Construction requires all of `PH7_HANDOFF_JWKS_URL`, `PH7_HANDOFF_ISSUER`, `PH7_HANDOFF_AUDIENCE`, `PH7_HANDOFF_ALLOWED_ALGORITHMS`, and `PH7_HANDOFF_MAX_TTL_SECONDS`; absent or partial configuration remains fail-closed and does not fetch a remote URL. The existing PostgreSQL serializable nonce-consumption/session transaction remains the sole replay protection and no browser identity fields can enter that path.

Tests added: `tests/jwks-handoff.test.ts` creates synthetic RS256 keys locally and covers valid verification/caching, malformed or unsigned tokens, forged signature, wrong audience, expiration/not-before, required claims, key rotation, unapproved algorithms, JWKS unavailability/timeout, and incomplete configuration. `scripts/test-postgres-authentication.ts` now performs its concurrent replay, CSRF, invalidation, and repository-restart checks using the asymmetric JWKS verifier and generated synthetic keys against only the dedicated database. Validation on 2026-09-24 passed: database identity/schema verification; lint; typecheck; static migration validation; 47 unit tests; PostgreSQL integrity, concurrency, runtime-restart, and asymmetric-JWKS replay/restart tests; and production build. The validated revision was deployed only to the deployment-protected isolated preview `https://ph7-referral-growth-engine-dz2u00k7o-ph7-dispensarys-projects.vercel.app`. Protected smoke tests returned home `200`, admin `404`, portal `307`, invalid referral `200` with safe copy, synthetic PostgreSQL offer `200`, malformed hand-off `401`, and unsigned webhook `400`; checked responses contained no configured-secret markers and the preview had zero error-level log events.

Remaining pH7 dependency: pH7 must independently approve and provide the exact issuer, audience, HTTPS JWKS URL, key lifecycle/rotation policy, asymmetric algorithm(s), TTL, token delivery/return UX, and signed-token implementation. Those values are intentionally not configured in the isolated preview, so it continues to reject all real hand-offs. This phase neither accesses pH7 nor creates patient traffic, authentication-provider integration, GA4, DNS, banking/payment, or production deployment.

## Confirmed pH7 contract and staging defect fixes — 2026-09-30

The Referral Engine now implements the confirmed pH7-side contract while remaining isolated from the pH7 application. Browser hand-off is available at `POST /auth/handoff`; it accepts only a token body field, verifies the configured ES256/JWKS contract, consumes the nonce through the existing PostgreSQL session service, sets the secure opaque session cookies, and redirects to `/portal`. The JSON `POST /api/auth/handoff` endpoint remains for programmatic checks.

The public funnel now creates/resolves an opaque attribution ID server-side and posts the CTA to `/r/[code]/continue`, which redirects to the server-configured `PH7_PATIENTS_URL` with only `attribution_id`. `REFERRAL_PUBLIC_URL`/`VERCEL_URL` drives canonical referral links, QR, copy, and WhatsApp share URLs so deployed staging no longer emits `localhost`.

Webhook verification now requires `x-ph7-timestamp` and `x-ph7-signature`, with the signature calculated over `timestamp + "." + raw_body`. Invalid signatures, malformed/stale/future timestamps, and invalid payloads return 4xx; duplicate events, successful events, and structurally valid unknown attributions return 2xx; genuine runtime failures return 5xx. Unknown attributions are claimed and marked processed without creating referrals or rewards.

Portal monetary totals now coerce PostgreSQL numeric/bigint values to explicit integer minor units before calculation. Regression coverage proves string values do not concatenate, pending rewards stay separate from available balance, payout debits reduce availability, reversals reduce availability, and lifetime earned remains a sum of credit entries. Friend incentives are displayed as programme configuration awaiting the pH7 checkout/commercial agreement; no fake discount or checkout mechanism was added.

## Staging review mode — Clickable product demo

Acceptance: **implemented for isolated preview review only.** The root page now becomes a polished review landing page only when `APP_ENV=preview` and `REFERRAL_DEMO_MODE=true` are explicitly configured. It links to the patient portal, referred-friend journey, founder admin, and `/integration` status page. Without those flags, production authentication paths remain fail-closed.

`scripts/ensure-staging-demo-fixture.ts` and `npm run db:ensure-staging-demo` prepare synthetic PostgreSQL records for referral code `PH7DEMO`. The fixture includes a synthetic patient/referrer, referral code, active programme if none exists, referral states across registered/booked/paid/payable/paid-out/fraud/refund, immutable ledger credits/reversal/payout debit, payout account/request, fraud flags, founder audit records, and a demo founder actor. It uses only the dedicated Referral Growth Engine database and never prints credentials.

The patient portal in demo mode reads PostgreSQL-backed balances, referral history, payout history, QR/share data, and withdrawal requests. The founder admin in demo mode uses PostgreSQL-backed read models and existing server-side production action boundaries for campaign changes, payout requests, Mark Paid, fraud flagging/resolution, and audit history. The referred-friend route uses the existing database attribution service; `/r/PH7DEMO` creates/resolves opaque attribution and `/r/continue` clearly explains the staging pH7 hand-off boundary. `/integration` documents readiness and future pH7 contracts without exposing secret values.

Validation before deployment: database identity/schema verification passed; `npm run db:ensure-staging-demo` passed; lint, typecheck, static migration validation, 47 unit tests, PostgreSQL integration, concurrency/idempotency, restart-persistence, asymmetric-JWKS auth replay/restart tests, and production build passed. Browser automation was not locally available, so local route-level smoke tests covered `/`, `/portal`, `/admin`, admin tabs, `/integration`, `/r/PH7DEMO`, and `/r/INVALID1` with successful HTTP responses and no application-error marker.

## Phase 11 — Isolated Vercel deployment

Acceptance: user has explicitly approved a new Vercel project and dedicated environment/database; no existing project, DNS, route, or production infrastructure is overwritten; environment variables are set safely; deployment and smoke test are documented.
