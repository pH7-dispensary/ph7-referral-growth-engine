# pH7 Referral Growth Engine

Standalone referral infrastructure for pH7. The engine owns referral codes, attribution, immutable referral economics, reward qualification, payout workflow, fraud review, audit history, and the integration boundary back into pH7.

## Architecture

```text
pH7.health / pH7 App
  -> signed patient hand-off
Referral Growth Engine
  -> referral link and opaque attribution_id
Referred friend returns into pH7.health
  -> pH7 consultation event
Referral Engine qualification and reward ledger
```

The pH7 app owns patient authentication, consultations, and clinical/payment events. The Referral Growth Engine owns referral programme state and financial history. Neither system needs direct database access to the other.

## Stack

- Next.js App Router and React
- TypeScript
- PostgreSQL/Supabase-compatible SQL migrations
- Server-side domain services and repository adapters
- Vitest test suite
- Vercel preview deployment support

## Local Setup

```bash
npm install
cp .env.example .env.local
```

Fill `.env.local` with local or isolated staging values. Never commit `.env.local`, `.vercel`, `.next`, or `node_modules`.

Required server-only variables for database-backed operation:

- `REFERRAL_DATABASE_URL`
- `ADMIN_SESSION_SECRET`
- `PATIENT_SESSION_SECRET`
- `PH7_WEBHOOK_SECRET`

Future pH7 hand-off variables are documented in `.env.example` but should stay empty until pH7 provides the signed hand-off contract.

## Database

Migrations live in [db/migrations](/Users/oska/Documents/pH7-referral-growth-engine/db/migrations).

Apply only to a dedicated Referral Growth Engine database:

```bash
npm run db:identity
npm run db:apply
npm run db:verify
```

For the staging review fixture:

```bash
npm run db:ensure-staging-demo
```

That fixture creates synthetic data only.

## Development

```bash
npm run dev
```

Explicit staging demo mode requires both:

```text
APP_ENV=preview
REFERRAL_DEMO_MODE=true
```

Demo mode is for review only. It does not enable real pH7 authentication, GA4, banking, DNS, or production patient traffic.

## Validation

```bash
npm run validate
npm run build
npm run db:verify
npm run test:database
npm run test:database:concurrency
npm run test:database:persistence
npm run test:database:auth
```

## Important Docs

- [pH7 integration contract](docs/referral-engine/PH7_INTEGRATION.md)
- [Architecture](docs/referral-engine/ARCHITECTURE.md)
- [Security](docs/referral-engine/SECURITY.md)
- [Database](docs/referral-engine/DATABASE.md)
- [Events and webhooks](docs/referral-engine/EVENTS.md)
- [Implementation history](docs/referral-engine/IMPLEMENTATION.md)
- [Operations](docs/referral-engine/OPERATIONS.md)

## Integration Points

The pH7 developer needs to provide:

- Patient hand-off JWKS URL, issuer, audience, algorithm allow-list, token TTL, and key rotation policy.
- Attribution handling for opaque `attribution_id`.
- Signed webhook contract for `consultation.paid` and `consultation.refunded`.

See [PH7_INTEGRATION.md](docs/referral-engine/PH7_INTEGRATION.md) for the exact practical contract.

## Security Notes

This repository is safe to publish because security depends on server-side controls and environment secrets, not source-code secrecy. Do not commit real credentials, patient data, private keys, session values, webhook secrets, database URLs, or banking details.
