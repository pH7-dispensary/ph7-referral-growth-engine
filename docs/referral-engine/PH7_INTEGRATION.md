# pH7 Integration Contract

The Referral Growth Engine is ready for isolated staging review. It is configured to support the confirmed pH7 contract below, but it must still fail closed if pH7 has not deployed PR #1524 with a signing key and live JWKS contents. The pH7 application must not share its patient database or delegate referral economics to pH7.

## Confirmed non-secret contract

- `PH7_HANDOFF_JWKS_URL=https://app.ph7.health/api/v1/referral/jwks`
- `PH7_HANDOFF_ISSUER=https://app.ph7.health`
- `PH7_HANDOFF_AUDIENCE=ph7-referral-engine`
- `PH7_HANDOFF_ALLOWED_ALGORITHMS=ES256`
- `PH7_HANDOFF_MAX_TTL_SECONDS=300`
- pH7 patient references use the regional shape `pat_eu_123`; the region prefix is permanent because EU and AU patient IDs can overlap.
- `email_hash` is the SHA-256 hex digest of the lower-cased email address.
- Key rotation requires pH7 to publish the new public key alongside the old public key before switching signing keys.
- The friend destination is `PH7_PATIENTS_URL=https://patients.ph7.health`; the Referral Engine appends only `attribution_id=<opaque attr_...>`.

## 1. Patient hand-off

pH7 authenticates the patient, then submits the browser to `POST /auth/handoff` with a single `token` field. The token is a short-lived ES256 JWT. The Referral Engine verifies the token against pH7 public keys before creating its own patient session and redirects the browser to `/portal`. The token must not be placed in the URL.

Required from pH7:

- HTTPS JWKS URL listed above.
- Exact issuer and audience listed above.
- ES256 only.
- Maximum token TTL of 300 seconds.
- Protected `kid` header and key rotation policy.
- Claims: `patient_reference`, `email_hash`, `nonce`, `issued_at`, `expires_at`, plus standard `iss`, `aud`, `iat`, and `exp`.

The Referral Engine consumes each nonce once in PostgreSQL. Duplicate, malformed, stale, wrong-audience, wrong-issuer, wrong-algorithm, or unavailable-JWKS hand-offs fail generically. The older JSON `POST /api/auth/handoff` path is retained for programmatic tests; browser traffic should use `/auth/handoff`.

## 2. Attribution hand-off

Referral links create an opaque `attribution_id`. The CTA redirects to the configured pH7 patient boundary as `https://patients.ph7.health/?attribution_id=attr_...`. pH7 should accept and store that reference during signup/account creation, then echo it in later trusted consultation events.

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

- `x-ph7-signature`: lowercase hex HMAC-SHA256 signature over `x-ph7-timestamp + "." + raw_body`.
- `x-ph7-timestamp`: ISO-8601 timestamp exactly matching the JSON `timestamp` field.
- Timestamp tolerance: 300 seconds unless separately configured.
- Retry policy: 5xx is retryable; 4xx is permanent and should not be retried; 2xx means success, duplicate, or safely acknowledged unknown attribution.
- Final mapping of consultation references, refunds, and cancellation states.

Duplicate `event_id` values are idempotent and cannot create duplicate rewards. A structurally valid event with an unknown `attribution_id` receives a 2xx acknowledgement and creates no reward.

## Pending product/commercial contract

The displayed friend incentive is programme configuration only until pH7 checkout integration is agreed. The Referral Engine must not invent a discount code, assume who funds it, alter doctor economics, or guarantee that pH7 checkout applies it. This remains **PENDING PRODUCT/COMMERCIAL CONTRACT**.

## Still intentionally disconnected

The Referral Engine production deployment is prepared for `https://refer.ph7.health`, but public DNS must be configured before that domain resolves. pH7 still owns its app-side release, real patient authentication, checkout discount application, consultation webhooks, Viva checkout source, GA4, banking/payment providers, and production payout automation.

pH7 application variables to configure outside this repository:

- `REFERRAL_WEBHOOK_URL=https://refer.ph7.health/api/webhooks/ph7`
- `NEXT_PUBLIC_REFERRAL_ENGINE_URL=https://refer.ph7.health`
- `REFERRAL_WEBHOOK_SECRET` equal to the Referral Engine `PH7_WEBHOOK_SECRET`, transferred only through an approved secure channel.
