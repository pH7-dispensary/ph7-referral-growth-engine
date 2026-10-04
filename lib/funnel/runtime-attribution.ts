import "server-only";
import { DatabaseAttributionService } from "@/lib/funnel/database-attribution";
import { getSyntheticAttributionService, type FunnelOfferResolution, type OpaqueAttribution } from "@/lib/funnel/attribution";
import { getPostgresExecutor, referralDatabaseConfigured } from "@/lib/persistence/node-postgres";

function runtimeService() {
  if (referralDatabaseConfigured()) return new DatabaseAttributionService(getPostgresExecutor());
  if (process.env.NODE_ENV === "development") return getSyntheticAttributionService();
  throw new Error("PostgreSQL persistence is required for referral attribution.");
}

export async function resolveRuntimeOffer(code: string): Promise<FunnelOfferResolution> {
  return runtimeService().resolveOffer(code);
}
export async function createRuntimeAttribution(input: { code: string; journeyId: string }): Promise<{ attribution: OpaqueAttribution; created: boolean }> {
  return runtimeService().createOrResolveAttribution(input);
}
export async function findRuntimeAttribution(id: string): Promise<OpaqueAttribution | null> {
  return runtimeService().findAttribution(id);
}
