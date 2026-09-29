# Database Design

## Conventions

Use PostgreSQL migrations, UUID primary keys, UTC timestamps, integer minor currency units with ISO currency code, `created_at`/`updated_at`, and foreign keys. Sensitive payloads are minimised and protected. Database transactions protect state and financial writes.

## Core entities

| Entity | Responsibility | Essential invariants |
|---|---|---|
| `referral_users` | Referral-engine representation of a pH7 patient | `patient_reference` unique; store hashed/minimal identity only |
| `referral_codes` | Stable code for a user | code unique; active code belongs to one user |
| `campaigns` | Time-bounded offer configuration | active campaign selection is deterministic |
| `programme_settings` | Current default programme controls | current only; never used to recompute history |
| `referral_attributions` | Anonymous click attribution | unique opaque public-safe ID, unique hashed journey/code context, immutable code and campaign snapshot |
| `referrals` | Friend/referrer conversion lifecycle | one applicable referral per qualified attribution/conversion; status changes through services |
| `referral_events` | Domain and funnel event history | append-only event log |
| `reward_ledger` | Immutable reward credits/debits | append-only; idempotency key unique; signed minor amount |
| `payout_accounts` | Verified/entered payout destination | encrypted IBAN/token data; never log raw account data |
| `payout_requests` | Withdrawal workflow | one request has a controlled lifecycle and payout ledger entry |
| `fraud_flags` | Deterministic review flags | status and resolution are auditable |
| `admin_users` | Founder/admin authorization | separate from referral users |
| `admin_audit_log` | Admin actions | append-only actor/action/subject/before-after metadata |
| `webhook_events` | External-delivery idempotency and audit | provider `event_id` unique; raw payload protected/minimised |

## Economics snapshot

At attribution/referral creation, persist campaign ID/version plus snapshot fields: friend incentive amount, referrer reward amount, currency, qualification event, holding period, caps applicable, and campaign/programme identifiers. Future setting changes make new snapshots only. Existing records and ledger entries remain unchanged.

## Ledger model

`reward_ledger` has a signed `amount_minor`, type (`CREDIT`, `PAYOUT`, `REVERSAL`, adjustment types if later approved), status/effective timestamp, referral/payout references, and unique idempotency key. Available balance is the sum of valid/effective ledger entries, optionally cached only as a derived value. A payout is posted only when marked paid; a refunded qualification produces exactly one compensating reversal where valid. Do not update or delete historical ledger rows.

## Critical database constraints

- unique referral code
- unique external webhook `event_id`
- unique ledger idempotency key
- unique conversion association where business rules require it
- unique opaque attribution public ID and unique hashed attribution context
- one `PAYOUT` ledger debit per payout request
- check currency amounts and permitted enum values
- foreign keys for all financial references
- transaction-level locking/serializable protection for withdrawal and reward posting paths

## Staging review data

Explicit demo mode uses only synthetic records in the dedicated Referral Growth Engine database. The current review fixture is created by `npm run db:ensure-staging-demo` and is scoped around referral code `PH7DEMO`, a synthetic patient reference, synthetic payout account data, synthetic fraud flags, and synthetic audit records. These records exist to demonstrate the live PostgreSQL persistence paths and must not be confused with pH7 production patient data.

## Step 11.1 persistence boundary

`lib/persistence/postgres.ts` defines a driver-neutral, injected SQL executor and the first PostgreSQL repository adapter. It contains no connection string or client construction. The runtime composition root must be the sole location that creates a database client after an explicitly approved isolated database exists. Public routes receive opaque attribution IDs only; repository code resolves them to internal UUIDs. Attribution context is a one-way hash, not a cookie or patient identifier.

The migration is not validated against a live server in this step. Before production readiness, apply it to a newly created isolated test database, inspect all constraints/triggers, run database-level concurrency tests, and perform a restore drill.
