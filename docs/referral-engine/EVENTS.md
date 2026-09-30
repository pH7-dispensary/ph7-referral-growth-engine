# Events and Integration Contracts

## First-party/GA4 behavioural events

Emit: `referral_portal_view`, `referral_share_clicked`, `referral_link_copied`, `referral_qr_viewed`, `referral_landing_view`, `referral_cta_clicked`, `referral_registered`, `referral_booked`, `referral_paid`, `referral_qualified`, `withdrawal_started`, and `withdrawal_requested`. Attach anonymous/referral context only where consent and privacy policy permit. GA4 is never used as a financial authority.

## Confirmed signed patient hand-off

The pH7 app submits the user's browser to `POST /auth/handoff` with one `token` field containing a short-lived ES256 JWT. Minimum verified claims:

```json
{ "patient_reference": "pat_eu_123", "email_hash": "lowercase-sha256-hex", "issued_at": "ISO-8601", "expires_at": "ISO-8601", "nonce": "unique" }
```

The compact JWS must have a protected `kid` and `alg=ES256`; the verified JWT must contain `iss=https://app.ph7.health`, `aud=ph7-referral-engine`, integer `iat`/`exp`, `patient_reference`, `email_hash`, `nonce`, `issued_at`, and `expires_at`. `issued_at` and `expires_at` must be ISO-8601 values that exactly match `iat` and `exp`; `nbf`, if present, is validated. The maximum TTL is 300 seconds. The Referral Engine consumes a one-way nonce HMAC once, in the same database transaction that creates the session; duplicate delivery is rejected generically. If pH7 PR #1524 has not deployed the signing key or JWKS is unavailable, the flow remains fail-closed.

## Confirmed attribution hand-off

The funnel redirects to the configured pH7 acquisition URL with only an opaque `attribution_id`: `https://patients.ph7.health/?attribution_id=attr_...`. The base URL is server-side configuration (`PH7_PATIENTS_URL`) and is validated as HTTPS with no embedded credentials or fragment. pH7 must attach that opaque reference to registration/account/consultation records and later echo it in signed consultation webhooks.

## Future pH7 webhook

`POST /api/webhooks/ph7` accepts a raw-body signed event. Minimum payload:

```json
{ "event_id": "evt_example_001", "type": "consultation.paid", "patient_reference": "pat_example", "consultation_reference": "con_example", "attribution_id": "attr_example", "timestamp": "ISO-8601" }
```

Supported initial types: `consultation.paid`, `consultation.refunded`. The sender must set `x-ph7-timestamp` to the same ISO timestamp as the JSON payload and `x-ph7-signature` to HMAC-SHA256 over `timestamp + "." + raw_body`. Default tolerance is 300 seconds. The remaining contract details are secret rotation, canonical payload encoding, delivery IP policy (if any), revenue/currency fields for metrics, and mappings for cancellation/refund completeness.

Webhook processing sequence: verify timestamp-bound signature → validate schema → insert/claim unique event ID → resolve attribution/referral → call the same domain service as admin simulation → append audit/event records where applicable → return an appropriate deterministic response. Duplicate delivery returns 2xx and produces no second effect. Unknown attribution returns 2xx and creates no rewards. Invalid signatures, stale/future timestamps, malformed timestamps, and invalid payloads return 4xx. Temporary Referral Engine failures return 5xx.

## Staging review

The `/integration` page in explicit demo mode summarizes these contracts for pH7 developers and shows only synthetic placeholder payloads. It must never display webhook secrets, hand-off configuration values, signing keys, database URLs, or real patient references.
