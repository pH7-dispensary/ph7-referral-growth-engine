"use client";

import { useActionState } from "react";
import type { PayoutActionState } from "@/lib/portal/actions";
import { formatEuro } from "@/lib/portal/format";
import { withdrawalPresentation } from "@/lib/portal/withdrawal";

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
  const { canRequest: canWithdraw, reason: disabledReason } = withdrawalPresentation(availableBalanceMinor, minimumWithdrawalMinor, hasAction);
  const [state, formAction, isPending] = useActionState(action ?? unavailablePayoutAction, initialPayoutActionState);
  if (!hasAction) {
    return <div className="payout-unavailable">
      <p className="eyebrow">Withdrawals</p>
      <h2>Your rewards are safely held.</h2>
      <p><strong>{formatEuro(availableBalanceMinor)} available.</strong> Online withdrawals are not available yet.</p>
      <p className="form-note">pH7 reviews payouts manually. Your balance remains recorded, and you can follow existing requests in payout history.</p>
      {minimumWithdrawalMinor > 0 ? <p className="form-note">Minimum withdrawal: {formatEuro(minimumWithdrawalMinor)}.</p> : null}
    </div>;
  }
  return (
    <form action={formAction} className="payout-form" aria-busy={isPending}>
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
      <p id="withdrawal-eligibility" className="form-note">{canWithdraw ? `Minimum withdrawal: ${formatEuro(minimumWithdrawalMinor)}.` : disabledReason}</p>
      <button className="button button-dark button-full" disabled={isPending || !canWithdraw} type="submit" aria-describedby="withdrawal-eligibility">
        {isPending ? "Checking details…" : "Withdraw funds"}
      </button>
      <div className="payout-feedback" role="status" aria-live="polite" aria-atomic="true">
        {!isPending && state.status !== "idle" ? <p className={`form-result form-result-${state.status}`}>{state.message}</p> : null}
      </div>
    </form>
  );
}
