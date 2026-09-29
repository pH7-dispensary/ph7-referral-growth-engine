# Product Specification

## Purpose

The pH7 Referral Growth Engine is a standalone application that lets eligible pH7 patients share a referral, attributes prospective friends, records qualified conversions, and administers reward payouts. It is architecturally separate from the pH7 patient application and owns the referral programme, attribution, reward economics, and referral lifecycle.

## V1 surfaces

### Patient referral portal

Authenticated through a future pH7 signed hand-off. Displays the active offer, personal referral URL and code, QR code, WhatsApp share, copy-link action, pending/available/lifetime rewards, referral history and per-referral progress, withdrawal, and payout history. It must not expose founder economics or admin controls. Development uses a safe local impersonation mechanism only.

### Referred-friend funnel

`/r/[code]` resolves an active referral code and campaign, creates one opaque attribution record, snapshots offer economics, presents the friend incentive, and redirects to a pH7 acquisition URL while preserving `attribution_id`. It records first-party funnel events. It must not disclose referrer private data.

### Founder admin

Access-controlled internal UI for Overview, Economics, Campaigns, Referrals, Payouts, Fraud, and Audit. Founder can control programme state, referrer reward, friend incentive, qualification event, holding period, withdrawal minimum, caps, campaigns, and individually authorised overrides. It reports conversion funnel, CAC, reward spend, revenue/reward ratio, active referrers, reward liability, payout queue, fraud flags, and audit history.

### Staging review mode

The isolated Vercel preview may explicitly enable `APP_ENV=preview` and `REFERRAL_DEMO_MODE=true`. That mode opens a polished synthetic review environment backed by the dedicated PostgreSQL database. It lets a pH7 developer review the patient portal, referred-friend journey, founder admin, payout queue, fraud workflow, audit history, and integration status without connecting real pH7 authentication, consultation events, GA4, banking, DNS, or patient data.

## Product invariants

- A historical referral retains the economics captured at creation; changing current settings affects only future referrals.
- The database ledger, not analytics nor referral rows, is the financial source of truth.
- Clients cannot mutate referral state or financial balance.
- Every material state, financial, fraud, and admin action is auditable.
- Duplicate external events cannot create duplicate rewards or reversal entries.

## Non-goals for V1

Automated SEPA transfers, direct patient-database access, ML fraud scoring, referral tiers, an analytics warehouse, and changes to existing pH7 services are out of scope.
