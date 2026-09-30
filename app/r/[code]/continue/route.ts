import { NextResponse } from "next/server";
import { getOrCreateSyntheticJourneyId, storeSyntheticAttributionId } from "@/lib/funnel/cookies";
import { buildPatientDestinationUrl, PatientDestinationUnavailableError } from "@/lib/funnel/patient-destination";
import { createRuntimeAttribution } from "@/lib/funnel/runtime-attribution";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  try {
    const journeyId = await getOrCreateSyntheticJourneyId();
    const { attribution } = await createRuntimeAttribution({ code, journeyId });
    await storeSyntheticAttributionId(attribution.attributionId);
    return NextResponse.redirect(buildPatientDestinationUrl(attribution.attributionId), 303);
  } catch (error) {
    if (error instanceof PatientDestinationUnavailableError && process.env.NODE_ENV === "development") {
      return NextResponse.redirect(new URL("/r/continue", "http://localhost:3000"), 303);
    }
    return NextResponse.json({ error: "Referral invitation could not be continued." }, { status: 400 });
  }
}
