"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { PayoutActionState } from "@/lib/portal/actions";
import { formatEuro } from "@/lib/portal/format";
import { withdrawalPresentation } from "@/lib/portal/withdrawal";
import { maskIban } from "@/lib/portal/payout";

const initialPayoutActionState: PayoutActionState = { status: "idle" };
async function unavailablePayoutAction(): Promise<PayoutActionState> {
  return { status: "error", message: "Withdrawal requests are not available from this portal yet." };
}

export function PayoutForm({
  availableBalanceMinor,
  minimumWithdrawalMinor,
  action,
  note,
  savedAccount,
  requestKey,
  csrfToken,
  underReview,
}: {
  availableBalanceMinor: number;
  minimumWithdrawalMinor: number;
  action?: (previousState: PayoutActionState, formData: FormData) => Promise<PayoutActionState>;
  note?: string;
  savedAccount?: { id: string; accountMask: string };
  requestKey?: string;
  csrfToken?: string;
  underReview?: boolean;
}) {
  const hasAction = Boolean(action);
  const { canRequest: canWithdraw, reason: disabledReason } = withdrawalPresentation(availableBalanceMinor, minimumWithdrawalMinor, hasAction, underReview);
  const [state, formAction, isPending] = useActionState(action ?? unavailablePayoutAction, initialPayoutActionState);
  const [newAccount, setNewAccount] = useState(!savedAccount);
  const [submittedMask, setSubmittedMask] = useState("");
  const confirmationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "success") {
      confirmationRef.current?.focus({preventScroll:true});
      confirmationRef.current?.scrollIntoView({block:"nearest",behavior:"instant"});
    }
  }, [state.status]);
  if (!hasAction) {
    return <div className="payout-unavailable">
      <p className="eyebrow">Withdrawals</p>
      <h2>Your cash is safely held.</h2>
      <p><strong>{formatEuro(availableBalanceMinor)} available cash.</strong> Online withdrawals are not available yet.</p>
      <p className="form-note">pH7 reviews payouts manually. Your balance remains recorded, and you can follow existing requests in payout history.</p>
      {minimumWithdrawalMinor > 0 ? <p className="form-note">Minimum withdrawal: {formatEuro(minimumWithdrawalMinor)}.</p> : null}
    </div>;
  }
  if (state.status === "success") return <div ref={confirmationRef} className="payout-confirmation" role="status" aria-live="polite" tabIndex={-1}>
    <p className="eyebrow">{state.payoutStatus === "PAID" ? "Withdrawal paid" : "Withdrawal requested"}</p><h2>{state.payoutStatus === "PAID" ? "Your withdrawal is marked paid." : "Your request is in review."}</h2>
    <p>{state.message}</p><p className="form-note">Bank account {state.accountMask || submittedMask || savedAccount?.accountMask || "details securely stored"}.{state.payoutStatus !== "PAID" ? " Payment is manual, not instant." : ""}</p>
  </div>;
  return (
    <form action={formAction} className="payout-form" aria-busy={isPending} onSubmit={event => {
      const keyField = event.currentTarget.elements.namedItem("requestKey") as HTMLInputElement;
      if (!keyField.value) keyField.value = crypto.randomUUID();
      const iban = new FormData(event.currentTarget).get("iban");
      setSubmittedMask(typeof iban === "string" ? maskIban(iban) : savedAccount?.accountMask ?? "");
    }}>
      <input type="hidden" name="requestKey" defaultValue={requestKey ?? ""} />
      <input type="hidden" name="csrfToken" value={csrfToken ?? ""} />
      <div className="form-heading">
        <div>
          <p className="eyebrow">Withdrawal</p>
          <h2>Withdraw cash</h2>
        </div>
        <span>{formatEuro(availableBalanceMinor)} available</span>
      </div>
      <p className="form-note">We’ll send your available referral cash to this bank account.</p>
      <p className="form-note">{note ?? "pH7 reviews withdrawal requests manually before payment."}</p>
      {savedAccount && !newAccount ? <div className="saved-payout-account"><p>Bank account <strong>{savedAccount.accountMask}</strong></p>
        <input type="hidden" name="payoutAccountId" value={savedAccount.id} />
        <button className="portal-text-link" type="button" disabled={isPending || !canWithdraw} onClick={() => setNewAccount(true)}>Use another bank account</button>
      </div> : <>
      <label>
        Account holder name
        <input autoComplete="name" disabled={isPending || !canWithdraw} name="accountHolderName" required maxLength={120} placeholder="Name on the account" />
      </label>
      <label>
        IBAN
        <input autoComplete="off" autoCapitalize="characters" disabled={isPending || !canWithdraw} inputMode="text" name="iban" required maxLength={42} placeholder="Your IBAN" spellCheck={false} />
      </label>
      {savedAccount ? <button className="portal-text-link" type="button" disabled={isPending} onClick={() => setNewAccount(false)}>Use saved account {savedAccount.accountMask}</button> : null}
      </>}
      <label>
        Withdrawal amount
        <select defaultValue={String(availableBalanceMinor)} disabled={isPending || !canWithdraw} name="amountMinor">
          <option value={String(availableBalanceMinor)}>{formatEuro(availableBalanceMinor)} — available cash</option>
          {minimumWithdrawalMinor < availableBalanceMinor ? <option value={String(minimumWithdrawalMinor)}>{formatEuro(minimumWithdrawalMinor)} — minimum withdrawal</option> : null}
        </select>
      </label>
      <p id="withdrawal-eligibility" className="form-note">{canWithdraw ? `Minimum withdrawal: ${formatEuro(minimumWithdrawalMinor)}.` : disabledReason}</p>
      <button className="button button-dark button-full" disabled={isPending || !canWithdraw} type="submit" aria-describedby="withdrawal-eligibility">
        {isPending ? "Requesting withdrawal…" : "Confirm withdrawal"}
      </button>
      <div className="payout-feedback" role="status" aria-live="polite" aria-atomic="true">
        {!isPending && state.status !== "idle" ? <p className={`form-result form-result-${state.status}`}>{state.message}</p> : null}
      </div>
    </form>
  );
}
