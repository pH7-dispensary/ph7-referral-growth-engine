import { LocalContinuation } from "@/components/funnel/local-continuation";
import { UnavailableFriendOffer } from "@/components/funnel/friend-funnel";
import { findRuntimeAttribution } from "@/lib/funnel/runtime-attribution";
import { readSyntheticAttributionId } from "@/lib/funnel/cookies";

export const dynamic = "force-dynamic";

export default async function LocalContinuationPage() {
  const attributionId = await readSyntheticAttributionId();
  const attribution = attributionId ? await findRuntimeAttribution(attributionId) : null;
  if (!attribution) return <UnavailableFriendOffer reason="UNAVAILABLE" />;
  return <LocalContinuation attribution={attribution} />;
}
