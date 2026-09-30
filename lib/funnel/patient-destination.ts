import { isOpaqueAttributionId } from "@/lib/funnel/attribution";

export class PatientDestinationUnavailableError extends Error {
  constructor() { super("The pH7 patient destination is not configured."); }
}

export function buildPatientDestinationUrl(attributionId: string, configured = process.env.PH7_PATIENTS_URL): string {
  if (!isOpaqueAttributionId(attributionId)) throw new PatientDestinationUnavailableError();
  if (!configured) throw new PatientDestinationUnavailableError();
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new PatientDestinationUnavailableError();
  url.searchParams.set("attribution_id", attributionId);
  return url.toString();
}
