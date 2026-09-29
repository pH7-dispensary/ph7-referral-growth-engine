"use server";

import { requireDevelopmentPatientSession } from "@/lib/portal/dev-access";
import { getSyntheticPatientPortalData } from "@/lib/portal/data";
import { payoutRequestSchema } from "@/lib/portal/payout";

export interface PayoutActionState {
  status: "idle" | "success" | "error";
  message?: string;
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
