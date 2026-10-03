import { Logo } from "@/components/logo";
import type { FriendOffer, FunnelUnavailableReason } from "@/lib/funnel/attribution";
import { unavailableOfferCopy } from "@/lib/funnel/copy";
import { formatEuro } from "@/lib/portal/format";
import Link from "next/link";

function FunnelFrame({ children }: { children: React.ReactNode }) {
  return <main className="funnel-shell"><header className="funnel-header"><Link className="brand" href="/" aria-label="pH7"><Logo /></Link><span>Friend invitation</span></header>{children}</main>;
}

export function FriendFunnel({ offer }: { offer: FriendOffer }) {
  return (
    <FunnelFrame>
      <section className="funnel-hero">
        <p className="eyebrow">A little something for your wellbeing</p>
        <h1>You’ve been invited to try pH7.</h1>
        <p>Someone who values thoughtful, clinician-led care has shared their invitation with you.</p>
      </section>
      <section className="friend-offer-card" aria-label="Your referral offer">
        <p className="eyebrow">Your welcome offer</p>
        <strong>{formatEuro(offer.friendIncentiveMinor)} friend incentive</strong>
        <p>This incentive is programme configuration awaiting the approved pH7 checkout integration. There is no obligation to proceed.</p>
      </section>
      <section className="funnel-steps" aria-labelledby="friend-steps-title">
        <p className="eyebrow">What happens next</p><h2 id="friend-steps-title">A simple start</h2>
        <ol><li><span>1</span>Continue to the secure pH7 sign-up journey.</li><li><span>2</span>Choose the care that is right for you.</li><li><span>3</span>Your attribution reference is passed to pH7 without exposing referral economics.</li></ol>
      </section>
      <form action={`/r/${offer.code}/continue`} method="post" className="funnel-cta">
        <input name="code" type="hidden" value={offer.code} />
        <button className="button button-dark button-full" type="submit">Continue to pH7</button>
        <p>Production hand-off begins after an opaque attribution reference is created.</p>
      </form>
    </FunnelFrame>
  );
}

export function UnavailableFriendOffer({ reason }: { reason: FunnelUnavailableReason }) {
  const copy = unavailableOfferCopy(reason);
  return (
    <FunnelFrame>
      <section className="unavailable-card">
        <div className="unavailable-mark" aria-hidden="true">—</div>
        <p className="eyebrow">Referral invitation</p>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <Link className="button button-soft" href="/">Return to pH7</Link>
      </section>
    </FunnelFrame>
  );
}
