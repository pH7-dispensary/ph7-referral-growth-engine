import { Logo } from "@/components/logo";
import type { OpaqueAttribution } from "@/lib/funnel/attribution";
import { formatEuro } from "@/lib/portal/format";
import Link from "next/link";

export function LocalContinuation({ attribution }: { attribution: OpaqueAttribution }) {
  return (
    <main className="funnel-shell">
      <header className="funnel-header"><Link className="brand" href="/" aria-label="pH7"><Logo /></Link><span>Staging hand-off</span></header>
      <section className="continuation-card">
        <div className="success-mark" aria-hidden="true">✓</div>
        <p className="eyebrow">Invitation saved</p>
        <h1>Your welcome offer is ready.</h1>
        <p>Production hand-off to pH7 begins here. In staging, your invitation has been safely attributed without opening the real pH7 application.</p>
        <div className="continuation-offer"><span>Welcome offer</span><strong>{formatEuro(attribution.economics.friendIncentiveMinor)} off your first consultation</strong></div>
        <div className="attribution-note"><span>Opaque attribution reference</span><code>{attribution.attributionId}</code><p>This reference carries invitation context only. It does not contain patient identity or reward economics.</p></div>
        <Link className="button button-dark button-full" href={`/r/${attribution.code}`}>Back to invitation</Link>
      </section>
    </main>
  );
}
