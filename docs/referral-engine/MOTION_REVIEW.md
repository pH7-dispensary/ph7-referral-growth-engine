# Patient portal interaction review — 2026-10-03

Local review only. No deployment, production test records, database writes or infrastructure changes were made during this interaction pass. The approved pH7 colours, typography, composition and product direction remain unchanged.

## Implementation choices

| Interaction | Behaviour | Technique |
| --- | --- | --- |
| Share / copy | Confirmation replaces the label in place; returns after 2.4 seconds without blocking another action. Stale asynchronous responses and timers cannot overwrite a later intent. Native-share cancellation is not reported as success. | React state; CSS 110 ms opacity / 130 ms small label movement |
| Buttons, WhatsApp, retry | Immediate subtle press, 130 ms release; restrained fine-pointer hover. Touch does not retain a hover lift. WhatsApp is still a normal link, never a claimed successful send. | CSS transforms and pointer media queries |
| QR / referral details | Same trigger and content persist through entrance and exit. Expand 180 ms, collapse 130 ms, cubic-bezier(.22,1,.36,1). Repeated toggles reverse from the current rendered height rather than restarting from zero. | Native details progressively enhanced with WAAPI |
| Section navigation | Existing native anchors retain continuity; destinations can receive keyboard focus. Reduced motion retains immediate navigation. | Native anchors, CSS scroll behaviour, focusable destinations |
| Withdrawal feedback | Existing action is unchanged. Pending state announces busy status and prevents duplicate submission. Feedback sits below the stable submit control; old results are hidden while a new request is pending. | Existing React action state / accessible live region |
| Loading / error | Static, meaningful loading status rather than decorative shimmer; retry receives the same tactile feedback as other controls. | Existing boundaries; CSS |

The native disclosure height tween is a deliberate small layout-animation exception: scaling text or a QR image would damage legibility and scanning, while overlaying it would break document continuity. Geometry is measured once per interaction, not in a React render/frame loop. Animation is cancelled/settled on resize, preference changes and cleanup. Collapsing content is immediately inert and hidden from assistive technology; native keyboard activation and no-JavaScript disclosure behaviour remain available.

No Motion dependency was added. The four requested skills informed motion judgement, implementation-technique selection and rendered review; CSS and WAAPI fit these small interactions better than a component animation framework. The installed ui-animation supporting guides/scripts/evaluations and shared frontend capture helpers were unavailable, so core instructions, browser evidence and focused local tests were used. No missing resources were invented.

Balances, reward availability and referral statuses deliberately do not animate on page load. There is no live-update event contract to distinguish a newly earned reward from an existing historical reward. Animating them would imply a financial event that has not occurred. No generic scroll entrances or artificial success celebrations were added.

## Verification

- `npm run validate`: lint, typecheck, static migration validation and all **87 tests in 11 files** passed.
- `npm run build`: production build passed.
- New tests cover stale feedback, repeated-action timer renewal, cleanup, paired disclosure durations, rapid reversal, reduced motion, resize/preference interruption, no-WAAPI fallback and development-route exclusion in production/test modes.
- Rendered portal audit passed at **320×812, 390×844, 768×1024 and 1440×1000**. Actual browser viewport dimensions were checked, not inferred from requested sizes. No detected overflow, clipping, tiny text, contrast or target-size findings. This is not a complete WCAG audit.
- Copy feedback was observed in the actual browser; invite card height remained **345.5 px before and after**. Success is visually in-place and separately announced for screen readers. Redundant visible success text was removed after rendered review.
- QR and referral-details entrance/exit, repeated activation, native keyboard activation/focus and section navigation were checked in the running app. Browser warning/error capture was empty.
- The existing local synthetic portal was used. A development-only `/dev/interaction-review` fixture exercises real presentation components with fake, client-only delayed results. It performs no database, banking or financial IO and is unavailable outside development. A local production-mode request returned 404. Production portal authentication continued to redirect rather than render the authenticated dashboard without a session.
- Withdrawal pending/success/error and retry/loading states were reviewed through that isolated fixture, not through real payouts. Reduced motion was tested through the same disclosure controller using a preference simulation plus unit tests; CSS media-query overrides disable added transitions/transforms and existing smooth scrolling.

Physical iPhone/Safari and its OS-native share sheet/cancellation remain device checks before release. Browser viewport checks are not real touch-device or VoiceOver certification. Browser-wide OS preference emulation was unavailable; the preference simulation is explicitly a local fixture, not a claim of OS-level testing. No actual WhatsApp message was sent. No database/auth/security/financial behaviour was modified in this motion pass.

## Evidence

Local, clearly synthetic screenshots and responsive audit JSON are retained at:

`/Users/oska/.codex/visualizations/2026/09/23/01a0cf3a-5497-7b51-9a0a-0281a2faa1ec/ph7-refer-motion-2026-10-03/`

Files: `desktop-final.jpg`, `mobile-final.jpg`, `mobile-final-copy.jpg`, `mobile-final-qr.jpg`, `withdrawal-pending.jpg`, `withdrawal-success.jpg`, `withdrawal-error.jpg`, `reduced-motion-open.jpg`, `visual-qa.json`. Screenshots document rendered states, not a substitute for observing the transitions. Approval is required before production deployment.
