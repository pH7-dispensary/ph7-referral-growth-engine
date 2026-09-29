import { FriendFunnel, UnavailableFriendOffer } from "@/components/funnel/friend-funnel";
import { resolveRuntimeOffer } from "@/lib/funnel/runtime-attribution";

export const dynamic = "force-dynamic";

export default async function ReferralFriendPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const resolution = await resolveRuntimeOffer(code);
  if (resolution.kind === "unavailable") return <UnavailableFriendOffer reason={resolution.reason} />;
  return <FriendFunnel offer={resolution.offer} />;
}
