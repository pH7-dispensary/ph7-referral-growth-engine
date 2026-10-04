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

For iOS app shells that cannot safely hand a cross-domain POST directly to Safari, the Referral Engine exposes a browser-start endpoint at `GET /auth/handoff/start?code=<code>`. The `code` must be exactly 48 alphanumeric characters. Invalid codes return `400` and do not contact pH7. Valid codes are redeemed server-side by POSTing `{"code":"<code>"}` to the fixed pH7 URL `https://app.ph7.health/api/v1/referral/handoff/redeem`, signed with the same timestamp-bound HMAC convention used for pH7 webhooks. A successful redemption returns the ES256 JWT to the Referral Engine server, which then runs the existing `/auth/handoff` verifier/session logic and redirects `303` to `/portal` with the normal secure patient-session cookies. The endpoint never accepts caller-provided redirect destinations and never exposes the JWT or patient reference in the browser URL.

Required from pH7:

- HTTPS JWKS URL listed above.
- Exact issuer and audience listed above.
- ES256 only.
- Maximum token TTL of 300 seconds.
- Protected `kid` header and key rotation policy.
- Claims: `patient_reference`, `email_hash`, `nonce`, `issued_at`, `expires_at`, plus standard `iss`, `aud`, `iat`, and `exp`.

The Referral Engine consumes each nonce once in PostgreSQL. Duplicate, malformed, stale, wrong-audience, wrong-issuer, wrong-algorithm, or unavailable-JWKS hand-offs fail generically. The older JSON `POST /api/auth/handoff` path is retained for programmatic tests; browser traffic should use `/auth/handoff`.

## 2. Attribution hand-off

### Patient return navigation (2026-10-03 correction)

The patient portal's Back to pH7 control uses a fixed, same-tab HTTPS anchor to `https://patients.ph7.health/en/home`, without a query, fragment, token, identity, referrer or logout. The handoff issuer/redemption origin `app.ph7.health` is **not** the return destination. This return control does not change the signed entry flow or Refer session.

The live Patient domain currently serves Android `assetlinks.json` for `app.ph7` with `delegate_permission/common.handle_all_urls`, and an Apple association file identifying `69F2T3M9C4.app.pH7.user`. Both were read-only verified as HTTP 200, JSON, without redirects. The Apple file presently matches every path (`*`), not restricted Patient routes. These are public server declarations, **not verification** of the installed app's signing identity, Associated Domains entitlement, native URL handler, Android intent filters or browser dismissal support.

The actual native Patient App source was not available in the inspected local project locations. Do not infer a native bridge, invent a custom scheme, add `window.close()` or claim a device round trip. The native owner must inspect how Refer is presented; use a supported container dismissal if possible, otherwise handle the canonical Patient URL through the OS association. Verify the real iOS identity against the served association, `applinks:patients.ph7.health` entitlement and Universal Link lifecycle handler; scope the association to appropriate supported Patient routes in its owning repository. Verify Android HTTPS/host/path intent filters, `android:autoVerify`, installed signing certificate and device domain-verification state. Native changes require a new app build/release; whether they are necessary is pending source inspection. Physical iPhone/Safari/SFSafariViewController and Android Chrome repeated round trips remain required. Normal HTTPS fallback is available if native routing is unavailable; it does not transfer Patient authentication between browser contexts.

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

## 4. Friend incentive resolution (server-to-server)

pH7 checkout applies the friend incentive SNAPSHOTTED on the attribution, never the current campaign.

`POST /api/attributions/resolve` — signed exactly like `/api/webhooks/ph7` (hex HMAC-SHA256 over `"<x-ph7-timestamp>.<raw body>"` with `PH7_WEBHOOK_SECRET`, timestamp within tolerance).

Body: `{"attribution_id":"attr_…","patient_reference":"pat_eu_123"}` (strict; no other fields).

- `200 {"attribution_id","friend_incentive_minor","currency":"EUR"}` — from `referral_attributions` (immutable snapshot)
- `404` unknown attribution · `409` self-referral (patient is the referrer) · `401` bad signature · `400` malformed · `503` unavailable
- Read-only; `no-store`. Proven on PostgreSQL by `npm run test:database:incentive-snapshot` (€10 attribution stays €10 after the campaign moves to €15/€20; a new attribution gets €15).
