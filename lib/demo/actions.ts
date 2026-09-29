"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createFraudFlag, createPayoutRequest, markPayoutPaid, resolveFraudFlag, saveCampaign } from "@/lib/runtime/production-actions";
import type { FraudDecision, FraudType } from "@/lib/persistence/operations-postgres";
import { demoActor, demoPayoutInput, ensureDemoFixture } from "@/lib/demo/data";
import { requireReferralDemoMode } from "@/lib/demo/config";
import { payoutRequestSchema } from "@/lib/portal/payout";
import type { PayoutActionState } from "@/lib/portal/actions";

function refreshAdmin(tab: string): never {
  revalidatePath("/admin");
  redirect(`/admin?tab=${tab}`);
}

export async function openDemoPortal(): Promise<never> {
  requireReferralDemoMode();
  await ensureDemoFixture();
  redirect("/portal");
}

export async function openDemoAdmin(): Promise<never> {
  requireReferralDemoMode();
  await ensureDemoFixture();
  redirect("/admin");
}

export async function saveDemoCampaign(formData: FormData): Promise<never> {
  requireReferralDemoMode();
  await saveCampaign(await demoActor(), {
    friendIncentiveMinor: Number(formData.get("friend")),
    referrerRewardMinor: Number(formData.get("referrer")),
    holdingPeriodDays: Number(formData.get("holdingPeriodDays")),
    active: formData.get("active") === "on",
  });
  refreshAdmin("economics");
}

export async function requestDemoPayout(formData: FormData): Promise<never> {
  requireReferralDemoMode();
  const amountMinor = Number(formData.get("amountMinor"));
  await createPayoutRequest(await demoActor(), await demoPayoutInput(amountMinor));
  refreshAdmin("payouts");
}

export async function markDemoPayoutPaid(formData: FormData): Promise<never> {
  requireReferralDemoMode();
  const payoutId = String(formData.get("payoutId") ?? "");
  await markPayoutPaid(await demoActor(), payoutId, `demo:payout:paid:${payoutId}`);
  refreshAdmin("payouts");
}

export async function flagDemoFraud(formData: FormData): Promise<never> {
  requireReferralDemoMode();
  await createFraudFlag(await demoActor(), String(formData.get("referralId") ?? ""), String(formData.get("type") ?? "MANUAL_FLAG") as FraudType);
  refreshAdmin("fraud");
}

export async function resolveDemoFraud(formData: FormData): Promise<never> {
  requireReferralDemoMode();
  await resolveFraudFlag(await demoActor(), String(formData.get("flagId") ?? ""), String(formData.get("decision") ?? "INVESTIGATING") as FraudDecision);
  refreshAdmin("fraud");
}

export async function requestDemoPortalPayout(_previousState: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  requireReferralDemoMode();
  const input = await demoPayoutInput(Number(formData.get("amountMinor")));
  const result = payoutRequestSchema.safeParse({
    accountHolderName: formData.get("accountHolderName"),
    iban: formData.get("iban"),
    amountMinor: input.amountMinor,
    availableBalanceMinor: input.amountMinor,
    minimumWithdrawalMinor: 1000,
  });
  if (!result.success) return { status: "error", message: "Please use the synthetic account details and an available demo amount." };
  await createPayoutRequest(await demoActor(), { ...input, idempotencyKey: `demo:portal:payout:${input.amountMinor}` });
  revalidatePath("/portal");
  return { status: "success", message: "Your staging payout request is now waiting in founder review." };
}
