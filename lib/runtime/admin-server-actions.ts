import "server-only";

import { headers } from "next/headers";
import { assertSessionCsrf, currentAdminSession } from "@/lib/auth/server";
import { hasAdminAccess } from "@/lib/auth/authorization";
import type { FraudDecision, FraudType } from "@/lib/persistence/operations-postgres";
import { createFraudFlag, createPayoutRequest, markPayoutPaid, resolveFraudFlag, saveCampaign, type AuthorisedActor } from "@/lib/runtime/production-actions";

/** Resolve the actor from the HTTP-only session, never from form data or JSON. */
async function currentActor(): Promise<AuthorisedActor> {
  const session = await currentAdminSession();
  if (!session || !hasAdminAccess(session)) throw new Error("Admin authorisation is required.");
  assertSessionCsrf("ADMIN", session, (await headers()).get("x-csrf-token") ?? undefined);
  // The persisted admin record remains the authority for the role. Until a real
  // provider is authorised, there is no route that can mint this session.
  return { adminUserId: session.adminUserId, role: session.adminRole ?? null };
}

export async function saveCampaignForCurrentAdmin(input: { friendIncentiveMinor: number; referrerRewardMinor: number; active: boolean; holdingPeriodDays?: number }) { return saveCampaign(await currentActor(), input); }
export async function createPayoutRequestForCurrentAdmin(input: { referralUserId: string; payoutAccountId: string; amountMinor: number; idempotencyKey: string }) { return createPayoutRequest(await currentActor(), input); }
export async function markPayoutPaidForCurrentAdmin(payoutId: string, idempotencyKey: string) { return markPayoutPaid(await currentActor(), payoutId, idempotencyKey); }
export async function createFraudFlagForCurrentAdmin(referralId: string, type: FraudType) { return createFraudFlag(await currentActor(), referralId, type); }
export async function resolveFraudFlagForCurrentAdmin(flagId: string, decision: FraudDecision) { return resolveFraudFlag(await currentActor(), flagId, decision); }
