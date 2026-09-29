# pH7 Integration Contract

The Referral Growth Engine is ready for staging review, but it is not connected to real pH7 traffic. The pH7 application needs to provide only the connection points below. It must not share its patient database or delegate referral economics to pH7.

## 1. Patient hand-off

pH7 authenticates the patient, then sends the browser to the Referral Engine with a short-lived signed JWT. The Referral Engine verifies the token against pH7 public keys before creating its own patient session.

Required from pH7:

- HTTPS JWKS URL.
- Exact issuer.
- Exact audience.
- Approved asymmetric algorithm allow-list.
- Maximum token TTL, no more than 600 seconds.
- Protected `kid` header and key rotation policy.
- Claims: `patient_reference`, `email_hash`, `nonce`, `issued_at`, `expires_at`, plus standard `iss`, `aud`, `iat`, and `exp`.

The Referral Engine consumes each nonce once. Duplicate or malformed hand-offs fail generically.

## 2. Attribution hand-off

Referral links create an opaque `attribution_id`. pH7 should accept and store that reference during signup/account creation, then echo it in later trusted consultation events.

Do not parse the ID. It contains no patient identity and no reward economics.

## 3. Consultation webhooks

pH7 sends signed webhook events to `POST /api/webhooks/ph7`.

Initial event types:

- `consultation.paid`
- `consultation.refunded`

Safe example payload:

```json
{
  "event_id": "evt_synthetic_example",
  "type": "consultation.paid",
  "patient_reference": "pat_synthetic",
  "consultation_reference": "con_synthetic",
  "attribution_id": "attr_00000000000000000000000000000000",
  "timestamp": "2026-09-25T12:00:00.000Z"
}
```

Required from pH7:

- Signature header and algorithm.
- Secret/key rotation process.
- Timestamp tolerance.
- Retry policy and duplicate-delivery expectations.
- Final mapping of consultation references, refunds, and cancellation states.

Duplicate `event_id` values are idempotent and cannot create duplicate rewards.

## Still intentionally disconnected

Real pH7 authentication, real patient traffic, GA4, banking/payment providers, DNS/custom domains, and production payout automation remain disabled until separately authorised.
