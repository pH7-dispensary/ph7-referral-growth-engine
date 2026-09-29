# Referral State Machine

## States

Primary path: `VISITED → ATTRIBUTED → REGISTERED → BOOKED → PAID → QUALIFIED → PAYABLE → PAID_OUT`.

Exception states: `CANCELLED`, `REFUNDED`, `REJECTED`, `FRAUD_REVIEW`, `EXPIRED`.

## Controlled transitions

| From | To | Authority/effect |
|---|---|---|
| VISITED | ATTRIBUTED | Funnel service validates active code/campaign and snapshots economics |
| ATTRIBUTED | REGISTERED | Ingested trusted conversion signal |
| REGISTERED | BOOKED | Ingested trusted conversion signal |
| BOOKED | PAID | Signed payment event |
| PAID | QUALIFIED | Shared qualification service after rules/caps/fraud checks |
| QUALIFIED | PAYABLE | Holding period completion job/service |
| PAYABLE | PAID_OUT | Payout service after founder marks completed transfer |
| eligible non-terminal | FRAUD_REVIEW | Deterministic fraud service or founder flag |
| FRAUD_REVIEW | prior eligible state / REJECTED | Founder resolution with audit |
| paid/qualified/payable | REFUNDED | Signed refund or shared manual test path; create reversal if credit exists |
| eligible non-terminal | CANCELLED / EXPIRED | Controlled service based on trusted lifecycle/expiry rule |

All transitions are validated server-side. The client can request an action but cannot set a state. A transition writes a `referral_events` record in the same transaction. Terminal transitions are explicit and idempotent; no transition may bypass financial reversal rules.
