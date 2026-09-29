import "server-only";

import type { FraudDecision, FraudType, OperationalAuditActor, RuntimeCampaign } from "@/lib/persistence/operations-postgres";
import { getPostgresRuntime } from "@/lib/persistence/runtime";

/** Supplied by the future authentication wrapper; never inferred from client input. */
export interface AuthorisedActor { readonly adminUserId: string | null; readonly role: "FOUNDER" | "ADMIN" | null; readonly requestId?: string; }
function runtime() { const value = getPostgresRuntime(); if (!value) throw new Error("PostgreSQL persistence is required for production server actions."); return value; }
export function requireAuthorisedAdmin(actor: AuthorisedActor): OperationalAuditActor {
  if (!actor.adminUserId || (actor.role !== "FOUNDER" && actor.role !== "ADMIN")) throw new Error("Admin authorisation is required.");
  return { adminUserId: actor.adminUserId, requestId: actor.requestId };
}

export async function saveCampaign(actor: AuthorisedActor, input: { friendIncentiveMinor: number; referrerRewardMinor: number; active: boolean; holdingPeriodDays?: number }): Promise<RuntimeCampaign> {
  return runtime().setCampaign(input, requireAuthorisedAdmin(actor));
}
export async function createPayoutRequest(actor: AuthorisedActor, input: { referralUserId: string; payoutAccountId: string; amountMinor: number; idempotencyKey: string }) {
  return runtime().requestPayout(input, requireAuthorisedAdmin(actor));
}
export async function markPayoutPaid(actor: AuthorisedActor, payoutId: string, idempotencyKey: string) { return runtime().markPayoutPaid(payoutId, idempotencyKey, requireAuthorisedAdmin(actor)); }
export async function createFraudFlag(actor: AuthorisedActor, referralId: string, type: FraudType) { return runtime().flagFraud(referralId, type, requireAuthorisedAdmin(actor)); }
export async function resolveFraudFlag(actor: AuthorisedActor, flagId: string, decision: FraudDecision) { return runtime().resolveFraud(flagId, decision, requireAuthorisedAdmin(actor)); }
