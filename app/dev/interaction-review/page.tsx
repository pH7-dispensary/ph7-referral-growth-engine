import { notFound } from "next/navigation";
import { InteractionReview } from "@/components/portal/interaction-review";
import { getSyntheticPatientPortalData } from "@/lib/portal/data";

export const dynamic = "force-dynamic";
export default function InteractionReviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <InteractionReview portalData={getSyntheticPatientPortalData()} />;
}
