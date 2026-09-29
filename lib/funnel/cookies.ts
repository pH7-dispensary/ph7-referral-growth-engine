import "server-only";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

export const funnelJourneyCookie = "ph7_referral_funnel_journey";
export const funnelAttributionCookie = "ph7_referral_attribution";
const opaqueJourneyPattern = /^[a-f0-9-]{36}$/;

export async function getOrCreateSyntheticJourneyId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(funnelJourneyCookie)?.value;
  if (existing && opaqueJourneyPattern.test(existing)) return existing;
  const journeyId = randomUUID();
  cookieStore.set(funnelJourneyCookie, journeyId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 30 });
  return journeyId;
}

export async function storeSyntheticAttributionId(attributionId: string): Promise<void> {
  (await cookies()).set(funnelAttributionCookie, attributionId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 30 });
}

export async function readSyntheticAttributionId(): Promise<string | null> {
  return (await cookies()).get(funnelAttributionCookie)?.value ?? null;
}
