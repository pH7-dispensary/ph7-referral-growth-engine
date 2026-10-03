"use server";

import { requireDevelopmentPatientSession } from "@/lib/portal/dev-access";
import { getSyntheticPatientPortalData } from "@/lib/portal/data";
import { payoutRequestSchema } from "@/lib/portal/payout";
import { assertSessionCsrf, currentPatientSession } from "@/lib/auth/server";
import { hasPatientAccess } from "@/lib/auth/authorization";
import { getPostgresExecutor } from "@/lib/persistence/node-postgres";
import { requestPatientCashPayout } from "@/lib/portal/patient-payout";
import { revalidatePath } from "next/cache";

export interface PayoutActionState {
  status: "idle" | "success" | "error";
  message?: string;
  accountMask?: string;
  payoutStatus?: "REQUESTED" | "PAID";
}

export async function requestPatientPayout(_previousState: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  try {
    const session = await currentPatientSession();
    if (!hasPatientAccess(session)) return { status: "error", message: "Please reopen pH7 Refer from your signed-in pH7 account." };
    const csrf = formData.get("csrfToken");
    assertSessionCsrf("PATIENT", session, typeof csrf === "string" ? csrf : undefined);
    const payout = await requestPatientCashPayout(getPostgresExecutor(), session, formData);
    revalidatePath("/portal");
    if (payout.status === "PAID") return {status:"success",payoutStatus:"PAID",accountMask:payout.accountMask,message:"This withdrawal has already been marked paid. You can find it in payout history."};
    if (payout.status !== "REQUESTED") return {status:"error",message:"This withdrawal is no longer active. Check payout history before requesting another."};
    return { status: "success", payoutStatus:"REQUESTED", accountMask:payout.accountMask, message: "Withdrawal requested. pH7 will review it before sending your cash to your bank account." };
  } catch {
    // Never return/log raw form values, bank details, database errors or tokens.
    return { status: "error", message: "We couldn’t request this withdrawal. Check your details, available cash and withdrawal minimum, then try again." };
  }
}

export async function requestDevelopmentPayout(
  _previousState: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  await requireDevelopmentPatientSession();
  const portal = getSyntheticPatientPortalData();
  const result = payoutRequestSchema.safeParse({
    accountHolderName: formData.get("accountHolderName"),
    iban: formData.get("iban"),
    amountMinor: Number(formData.get("amountMinor")),
    availableBalanceMinor: portal.availableBalanceMinor,
    minimumWithdrawalMinor: portal.minimumWithdrawalMinor,
  });
  if (!result.success) return { status: "error", message: "Please check the account details and withdrawal amount." };

  // Phase 3 intentionally discards sensitive values after validation. Phase 6 will persist encrypted payout data transactionally.
  return { status: "success", message: "Your development withdrawal request is ready for review." };
}
