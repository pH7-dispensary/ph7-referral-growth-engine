# Events and Integration Contracts

## First-party/GA4 behavioural events

Emit: `referral_portal_view`, `referral_share_clicked`, `referral_link_copied`, `referral_qr_viewed`, `referral_landing_view`, `referral_cta_clicked`, `referral_registered`, `referral_booked`, `referral_paid`, `referral_qualified`, `withdrawal_started`, and `withdrawal_requested`. Attach anonymous/referral context only where consent and privacy policy permit. GA4 is never used as a financial authority.

## Future signed patient hand-off

The pH7 app sends the user to a Referral Engine endpoint with a short-lived signed token. Minimum verified claims:

```json
{ "patient_reference": "pat_…", "email_hash": "…", "issued_at": "ISO-8601", "expires_at": "ISO-8601", "nonce": "unique" }
```

Step 11.6 now supplies the Referral Engine adapter, but it remains disabled until pH7 formally supplies and approves the exact values below. The compact JWS must have a protected `kid` and one approved asymmetric `alg`; the verified JWT must contain `iss`, `aud`, integer `iat`/`exp`, `patient_reference`, `email_hash`, `nonce`, `issued_at`, and `expires_at`. `issued_at` and `expires_at` must be ISO-8601 values that exactly match `iat` and `exp`; `nbf`, if present, is validated. The pH7 contract must provide an HTTPS JWKS URL, issuer, audience, an exact allow-list of supported asymmetric algorithms, a maximum TTL of no more than 600 seconds, delivery/return UX, and key-rotation/revocation expectations. The Referral Engine consumes a one-way nonce HMAC once, in the same database transaction that creates the session; duplicate delivery is rejected generically.

## Future attribution hand-off

The funnel redirects to a pH7-approved acquisition URL with only an opaque `attribution_id`. Required decisions: allowlisted destination/return URL, query parameter naming, retention window, and which trusted pH7 flow attaches it to a registration or consultation.

## Future pH7 webhook

`POST /api/webhooks/ph7` accepts a raw-body signed event. Minimum payload:

```json
{ "event_id": "evt_example_001", "type": "consultation.paid", "patient_reference": "pat_example", "consultation_reference": "con_example", "attribution_id": "attr_example", "timestamp": "ISO-8601" }
```

Supported initial types: `consultation.paid`, `consultation.refunded`. Required contract details: signature algorithm/header and secret rotation, retry policy, timestamp tolerance, canonical payload encoding, delivery IP policy (if any), error/retry interpretation, revenue/currency fields for metrics, and mappings for cancellation/refund completeness.

Webhook processing sequence: verify signature → validate schema → insert/claim unique event ID → resolve attribution/referral → call the same domain service as admin simulation → append audit/event records → return an appropriate deterministic response. Duplicate delivery returns a successful idempotent response and produces no second effect.

## Staging review

The `/integration` page in explicit demo mode summarizes these contracts for pH7 developers and shows only synthetic placeholder payloads. It must never display webhook secrets, hand-off configuration values, signing keys, database URLs, or real patient references.
