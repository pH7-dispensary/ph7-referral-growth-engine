import "server-only";
import { DatabaseAttributionService } from "@/lib/funnel/database-attribution";
import { getSyntheticAttributionService, type FunnelOfferResolution, type OpaqueAttribution } from "@/lib/funnel/attribution";
import { getPostgresExecutor, referralDatabaseConfigured } from "@/lib/persistence/node-postgres";

export async function resolveRuntimeOffer(code: string): Promise<FunnelOfferResolution> {
  return referralDatabaseConfigured() ? new DatabaseAttributionService(getPostgresExecutor()).resolveOffer(code) : getSyntheticAttributionService().resolveOffer(code);
}
export async function createRuntimeAttribution(input: { code: string; journeyId: string }): Promise<{ attribution: OpaqueAttribution; created: boolean }> {
  return referralDatabaseConfigured() ? new DatabaseAttributionService(getPostgresExecutor()).createOrResolveAttribution(input) : getSyntheticAttributionService().createOrResolveAttribution(input);
}
export async function findRuntimeAttribution(id: string): Promise<OpaqueAttribution | null> {
  return referralDatabaseConfigured() ? new DatabaseAttributionService(getPostgresExecutor()).findAttribution(id) : getSyntheticAttributionService().findAttribution(id);
}
