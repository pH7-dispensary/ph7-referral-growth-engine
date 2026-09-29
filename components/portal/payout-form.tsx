"use client";

import { useActionState } from "react";
import { requestDevelopmentPayout, type PayoutActionState } from "@/lib/portal/actions";
import { formatEuro } from "@/lib/portal/format";

const initialPayoutActionState: PayoutActionState = { status: "idle" };

export function PayoutForm({
  availableBalanceMinor,
  minimumWithdrawalMinor,
  action = requestDevelopmentPayout,
  note = "For this development portal, account details are validated and immediately discarded. No money is sent.",
}: {
  availableBalanceMinor: number;
  minimumWithdrawalMinor: number;
  action?: (previousState: PayoutActionState, formData: FormData) => Promise<PayoutActionState>;
  note?: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialPayoutActionState);
  return (
    <form action={formAction} className="payout-form">
      <div className="form-heading">
        <div>
          <p className="eyebrow">Withdrawal</p>
          <h2>Send a payout request</h2>
        </div>
        <span>{formatEuro(availableBalanceMinor)} available</span>
      </div>
      <p className="form-note">{note}</p>
      <label>
        Account holder name
        <input autoComplete="name" name="accountHolderName" required maxLength={120} placeholder="Name on the account" />
      </label>
      <label>
        IBAN
        <input autoComplete="off" inputMode="text" name="iban" required maxLength={34} placeholder="e.g. PT50 0002 0123 1234 5678 9015 4" spellCheck={false} />
      </label>
      <label>
        Withdrawal amount
        <select defaultValue={String(availableBalanceMinor)} name="amountMinor">
          <option value={String(availableBalanceMinor)}>Available balance — {formatEuro(availableBalanceMinor)}</option>
          <option value={String(minimumWithdrawalMinor)}>Minimum — {formatEuro(minimumWithdrawalMinor)}</option>
        </select>
      </label>
      <p className="form-note">Minimum withdrawal: {formatEuro(minimumWithdrawalMinor)}.</p>
      {state.status !== "idle" ? <p aria-live="polite" className={`form-result form-result-${state.status}`}>{state.message}</p> : null}
      <button className="button button-dark button-full" disabled={isPending} type="submit">
        {isPending ? "Checking details…" : "Request withdrawal"}
      </button>
    </form>
  );
}
