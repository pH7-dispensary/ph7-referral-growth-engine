"use server";
import { redirect } from "next/navigation";
import { createLocalAdminSession, requireLocalAdmin } from "@/lib/local/admin-access";
import { getLocalReferralEngine, type FraudType } from "@/lib/local/engine";
import { getPostgresRuntime } from "@/lib/persistence/runtime";

function localDevelopmentEngine() {
  if (process.env.NODE_ENV !== "development") throw new Error("Synthetic admin persistence is development-only.");
  return getLocalReferralEngine();
}

export async function beginLocalAdmin(): Promise<never> { await createLocalAdminSession(); redirect("/admin?tab=overview"); }
export async function updateLocalProgramme(formData: FormData) { await requireLocalAdmin(); const database = getPostgresRuntime(); if (database && process.env.NODE_ENV !== "development") await database.setCampaign({ friendIncentiveMinor: Number(formData.get("friend")), referrerRewardMinor: Number(formData.get("referrer")), active: formData.get("active") === "on" }); else await localDevelopmentEngine().setEconomics({ friendIncentiveMinor: Number(formData.get("friend")), referrerRewardMinor: Number(formData.get("referrer")), active: formData.get("active") === "on" }); redirect("/admin?tab=economics"); }
export async function manualQualify(formData: FormData) { await requireLocalAdmin(); await localDevelopmentEngine().qualify(String(formData.get("referralId")), `manual:${String(formData.get("referralId"))}`, "MANUAL"); redirect("/admin?tab=referrals"); }
export async function requestLocalPayout(formData: FormData) { await requireLocalAdmin(); await localDevelopmentEngine().requestPayout("synthetic-ava", Number(formData.get("amount")), `admin-request:${String(formData.get("amount"))}`); redirect("/admin?tab=payouts"); }
export async function markLocalPayoutPaid(formData: FormData) { await requireLocalAdmin(); await localDevelopmentEngine().markPayoutPaid(String(formData.get("payoutId")), String(formData.get("payoutId"))); redirect("/admin?tab=payouts"); }
export async function flagLocalFraud(formData: FormData) { await requireLocalAdmin(); await localDevelopmentEngine().flag(String(formData.get("referralId")), String(formData.get("type")) as FraudType); redirect("/admin?tab=fraud"); }
export async function resolveLocalFraud(formData: FormData) { await requireLocalAdmin(); await localDevelopmentEngine().resolveFraud(String(formData.get("flagId")), String(formData.get("decision")) as "APPROVED" | "REJECTED" | "INVESTIGATING"); redirect("/admin?tab=fraud"); }
