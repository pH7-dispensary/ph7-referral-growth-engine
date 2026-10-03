import { Logo } from "@/components/logo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { referralDemoModeEnabled } from "@/lib/demo/config";
import { referralDatabaseConfigured } from "@/lib/persistence/node-postgres";

export const dynamic = "force-dynamic";

function StatusRow({ label, status, tone = "ready" }: { label: string; status: string; tone?: "ready" | "waiting" | "off" }) {
  return <p className="metric-row"><span>{label}</span><strong className={`integration-status integration-${tone}`}>{status}</strong></p>;
}

export default function IntegrationPage() {
  // Developer review is not a public production surface, even if preview
  // flags were accidentally copied into the production Vercel environment.
  if (process.env.APP_ENV === "production" || process.env.VERCEL_ENV === "production"
    || (process.env.NODE_ENV !== "development" && !referralDemoModeEnabled())) notFound();
  const handoffConfigured = Boolean(process.env.PH7_HANDOFF_JWKS_URL && process.env.PH7_HANDOFF_ISSUER && process.env.PH7_HANDOFF_AUDIENCE && process.env.PH7_HANDOFF_ALLOWED_ALGORITHMS && process.env.PH7_HANDOFF_MAX_TTL_SECONDS);
  const webhookConfigured = Boolean(process.env.PH7_WEBHOOK_SECRET);
  return (
    <main className="review-shell">
      <section className="review-hero">
        <Link className="brand" href="/" aria-label="pH7 Referral Growth Engine"><Logo /></Link>
        <span className="test-badge">Staging environment — synthetic data</span>
        <p className="eyebrow">Integration status</p>
        <h1>What is ready, and what pH7 still needs to connect.</h1>
        <p className="entry-copy">This page is intentionally explicit for developer review. It shows connection readiness without displaying credentials, tokens, keys, or environment values.</p>
      </section>

      <section className="integration-grid">
        <article className="mini-panel">
          <p className="eyebrow">Referral Engine status</p>
          <StatusRow label="Database" status={referralDatabaseConfigured() ? "CONNECTED" : "MISSING"} tone={referralDatabaseConfigured() ? "ready" : "waiting"} />
          <StatusRow label="Referral persistence" status="READY" />
          <StatusRow label="Reward ledger" status="READY" />
          <StatusRow label="Payout workflow" status="READY" />
          <StatusRow label="Fraud" status="READY" />
          <StatusRow label="Patient session architecture" status="READY" />
          <StatusRow label="Admin authorization architecture" status="READY" />
          <StatusRow label="Staging demo mode" status={referralDemoModeEnabled() ? "ENABLED" : "DISABLED"} tone={referralDemoModeEnabled() ? "ready" : "off"} />
        </article>
        <article className="mini-panel">
          <p className="eyebrow">External systems</p>
          <StatusRow label="pH7 signed hand-off receiver" status={handoffConfigured ? "READY" : "READY / WAITING FOR pH7 CONFIG"} tone={handoffConfigured ? "ready" : "waiting"} />
          <StatusRow label="pH7 JWKS" status={handoffConfigured ? "CONFIGURED" : "NOT CONNECTED"} tone={handoffConfigured ? "ready" : "waiting"} />
          <StatusRow label="pH7 consultation events" status={webhookConfigured ? "RECEIVER READY" : "NOT CONNECTED"} tone={webhookConfigured ? "ready" : "waiting"} />
          <StatusRow label="GA4" status="NOT CONNECTED" tone="off" />
          <StatusRow label="Banking" status="MANUAL / NOT CONNECTED" tone="off" />
          <StatusRow label="Real pH7 traffic" status="DISABLED" tone="off" />
        </article>
      </section>

      <section className="integration-contracts">
        <article className="review-card review-card-compact">
          <p className="eyebrow">Contract 1 - Patient hand-off</p>
          <h2>pH7 authenticated patient to signed short-lived token to Referral Engine</h2>
          <p>Required later: HTTPS JWKS URL, exact issuer, exact audience, approved asymmetric algorithm, maximum TTL, protected key id, and sender-side token implementation.</p>
        </article>
        <article className="review-card review-card-compact">
          <p className="eyebrow">Contract 2 - Attribution</p>
          <h2>Referral link to opaque attribution_id to pH7 signup/account</h2>
          <p>The Referral Engine creates the opaque reference. pH7 later attaches it to the signup or consultation record without receiving reward economics.</p>
        </article>
        <article className="review-card review-card-compact">
          <p className="eyebrow">Contract 3 - Consultation events</p>
          <h2>pH7 to signed Referral Engine webhook</h2>
          <pre className="payload-example">{`{
  "event_id": "evt_synthetic_example",
  "type": "consultation.paid",
  "patient_reference": "pat_synthetic",
  "consultation_reference": "con_synthetic",
  "attribution_id": "attr_00000000000000000000000000000000",
  "timestamp": "2026-09-25T12:00:00.000Z"
}`}</pre>
          <p>Supported initial event types: consultation.paid and consultation.refunded. Duplicate event IDs are idempotent.</p>
        </article>
      </section>
    </main>
  );
}
