"use client";

import { useActionState } from "react";
import type { PayoutActionState } from "@/lib/portal/actions";
import { formatEuro } from "@/lib/portal/format";

const initialPayoutActionState: PayoutActionState = { status: "idle" };
async function unavailablePayoutAction(): Promise<PayoutActionState> {
  return { status: "error", message: "Withdrawal requests are not available from this portal yet." };
}

export function PayoutForm({
  availableBalanceMinor,
  minimumWithdrawalMinor,
  action,
  note,
}: {
  availableBalanceMinor: number;
  minimumWithdrawalMinor: number;
  action?: (previousState: PayoutActionState, formData: FormData) => Promise<PayoutActionState>;
  note?: string;
}) {
  const hasAction = Boolean(action);
  const canWithdraw = hasAction && availableBalanceMinor >= minimumWithdrawalMinor && minimumWithdrawalMinor > 0;
  const [state, formAction, isPending] = useActionState(action ?? unavailablePayoutAction, initialPayoutActionState);
  const disabledReason = availableBalanceMinor <= 0
    ? "You do not have available rewards to withdraw yet."
    : availableBalanceMinor < minimumWithdrawalMinor
      ? `Minimum withdrawal: ${formatEuro(minimumWithdrawalMinor)}.`
      : "Secure in-portal withdrawal requests are not enabled yet; payout history is shown when manual payout requests exist.";
  return (
    <form action={formAction} className="payout-form">
      <div className="form-heading">
        <div>
          <p className="eyebrow">Withdrawal</p>
          <h2>Withdraw funds</h2>
        </div>
        <span>{formatEuro(availableBalanceMinor)} available</span>
      </div>
      <p className="form-note">{note ?? "Manual pH7 payout review remains in place. Bank details are only requested when a withdrawal can be submitted."}</p>
      <label>
        Account holder name
        <input autoComplete="name" disabled={!canWithdraw} name="accountHolderName" required maxLength={120} placeholder="Name on the account" />
      </label>
      <label>
        IBAN
        <input autoComplete="off" disabled={!canWithdraw} inputMode="text" name="iban" required maxLength={34} placeholder="e.g. PT50 0002 0123 1234 5678 9015 4" spellCheck={false} />
      </label>
      <label>
        Withdrawal amount
        <select defaultValue={String(availableBalanceMinor)} disabled={!canWithdraw} name="amountMinor">
          <option value={String(availableBalanceMinor)}>Available balance — {formatEuro(availableBalanceMinor)}</option>
          <option value={String(minimumWithdrawalMinor)}>Minimum — {formatEuro(minimumWithdrawalMinor)}</option>
        </select>
      </label>
      <p className="form-note">{canWithdraw ? `Minimum withdrawal: ${formatEuro(minimumWithdrawalMinor)}.` : disabledReason}</p>
      {state.status !== "idle" ? <p aria-live="polite" className={`form-result form-result-${state.status}`}>{state.message}</p> : null}
      <button className="button button-dark button-full" disabled={isPending || !canWithdraw} type="submit">
        {isPending ? "Checking details…" : "Withdraw funds"}
      </button>
    </form>
  );
}
