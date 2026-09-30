"use server";

import { redirect } from "next/navigation";
import { createRuntimeAttribution } from "@/lib/funnel/runtime-attribution";
import { getOrCreateSyntheticJourneyId, storeSyntheticAttributionId } from "@/lib/funnel/cookies";
import { buildPatientDestinationUrl, PatientDestinationUnavailableError } from "@/lib/funnel/patient-destination";

export async function beginLocalFriendContinuation(formData: FormData): Promise<never> {
  const code = typeof formData.get("code") === "string" ? String(formData.get("code")) : "";
  const journeyId = await getOrCreateSyntheticJourneyId();
  const { attribution } = await createRuntimeAttribution({ code, journeyId });
  await storeSyntheticAttributionId(attribution.attributionId);
  try {
    redirect(buildPatientDestinationUrl(attribution.attributionId));
  } catch (error) {
    if (!(error instanceof PatientDestinationUnavailableError)) throw error;
  }
  redirect("/r/continue");
}
