# pH7 Referral Growth Engine — Working Rules

## Project boundary

This repository is **only** the standalone pH7 Referral Growth Engine. Its root is `/Users/oska/Documents/pH7-referral-growth-engine`.

1. Never modify another repository, including the pH7 patient app, pH7 Ads, acquisition projects, shared infrastructure, or `pH7.health`, unless the user explicitly authorises the exact target.
2. Never connect directly to the pH7 production patient database or reuse another project's database.
3. The repository is locally linked, by explicit user authorisation, only to the isolated Vercel project `ph7-dispensarys-projects/ph7-referral-growth-engine`. Never pull from, build for, deploy to, or change `landingpage`, another pH7 project, production infrastructure, DNS, or routing without separate explicit authorisation.
4. Read this file and the relevant documents in `docs/referral-engine/` before editing.
5. Inspect the existing implementation before creating architecture; reuse before creating.
6. Keep financial logic server-side. Ledger operations must be transactional, idempotent, and auditable.
7. Historical referral economics are immutable: snapshot economics when attribution/referral is created and never silently recompute history from current settings.
8. Integrate with pH7 only through explicit signed hand-off and webhook contracts. The pH7 app must not own referral economics.
9. Run relevant tests after changes and update documentation whenever architecture changes.
10. Keep implementation simple: no direct production coupling, microservices, automated SEPA, ML fraud detection, referral tiers, or analytics warehouse in V1.

## Delivery protocol

Inspect → read relevant specification → implement the requested phase → test → diagnose/fix → retest → review changed files → update `docs/referral-engine/IMPLEMENTATION.md`. Stop only when acceptance criteria are met or an external dependency requires user input.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
