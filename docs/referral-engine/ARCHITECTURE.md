# Architecture

## Chosen architecture

A single standalone Next.js + TypeScript application, deployed only to a new isolated Vercel project when authorised. It will use a dedicated PostgreSQL/Supabase database. Next.js server routes/actions host domain services and integrations; browser code is limited to presentation and event capture. GA4 receives behavioural analytics, while PostgreSQL is authoritative for financial and operational data.

## Component boundaries

```text
pH7 Patient App -- signed, short-lived hand-off --> Referral Engine Portal
Referred Friend -- /r/[code] ---------------------> Referral Engine Funnel
Referral Engine -- opaque attribution_id ----------> pH7 acquisition/signup
pH7 consultation/payment -- signed webhook -------> /api/webhooks/ph7
                                                   -> Referral domain + immutable ledger
Founder -- authenticated admin -------------------> Admin UI + domain services
```

The Referral Engine owns referral codes, referrers, campaigns, attribution, snapshots, rewards, payout administration, fraud decisions, and audit logs. pH7 owns its patients, consultations, payments, and its own authentication. Neither system gets direct database access to the other.

## Domain-service rules

- State transitions are performed by server-only domain services with transaction boundaries.
- `qualifyReferral()` is shared by webhook and manual qualification paths.
- Ledger posting is performed by a single idempotent service, backed by unique database keys.
- Webhook ingestion records and locks `event_id` before applying business effects.
- Redirect attribution is opaque and uses a durable identifier rather than exposing financial logic to pH7.

## Environment classes

Development must use isolated local/test Supabase credentials, development signing keys, synthetic patient identities, test webhook fixtures, and a development acquisition URL. The isolated preview can enable explicit staging demo mode with synthetic PostgreSQL records only. Production configuration is not to be created or connected without later explicit authorisation.
