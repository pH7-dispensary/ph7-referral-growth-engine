"use client";

import { useEffect, useRef, useState } from "react";
import { PayoutForm } from "@/components/portal/payout-form";
import type { PayoutActionState } from "@/lib/portal/actions";
import { enhanceDisclosure } from "@/lib/portal/disclosure-motion";
import PortalError from "@/app/portal/error";
import PortalLoading from "@/app/portal/loading";
import { PortalDashboard } from "@/components/portal/portal-dashboard";
import type { PatientPortalData } from "@/lib/portal/data";

/** Development-only UI fixture. No server action, database or financial IO. */
export function InteractionReview({portalData}: {portalData: PatientPortalData}) {
  const [result, setResult] = useState<"success" | "error">("success");
  const [surface, setSurface] = useState("withdrawal");
  const [reduced, setReduced] = useState(false);
  const [offer, setOffer] = useState("updated");
  const [savedBank, setSavedBank] = useState(false);
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!disclosure.current) return;
    // Simulates the preference at the controller boundary without changing
    // the user's OS/browser settings or weakening the production component.
    const preference = reduced ? {
      matches: true, addEventListener() {}, removeEventListener() {},
    } as unknown as MediaQueryList : window.matchMedia("(prefers-reduced-motion: reduce)");
    return enhanceDisclosure(disclosure.current, preference);
  }, [reduced]);
  async function previewAction(): Promise<PayoutActionState> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return result === "success"
      ? { status: "success", message: "Synthetic preview: request received. Nothing was submitted or stored." }
      : { status: "error", message: "Synthetic preview: details could not be accepted. Review them and try again." };
  }
  return <div className={`portal-shell${reduced ? " motion-review-reduced" : ""}`}>
    <h1 className="portal-state-title">Interaction review</h1>
    <p>Development-only synthetic UI. No database writes or payout processing.</p>
    <label>Preview surface <select value={surface} onChange={event => setSurface(event.target.value)}>
      <option value="withdrawal">Withdrawal</option><option value="cash">Cash portal</option><option value="loading">Loading</option><option value="error">Error</option>
    </select></label>
    <label><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)} /> Reduced motion simulation</label>
    <details ref={disclosure} className="motion-disclosure">
      <summary>Disclosure motion preview</summary>
      <div className="disclosure-content"><p>Content expands from its trigger. Rapid re-toggles remain interruptible.</p><p>With reduced motion enabled, content appears and disappears immediately.</p></div>
    </details>
    <label>Preview response <select value={result} onChange={event => setResult(event.target.value as "success" | "error")}>
      <option value="success">Success</option><option value="error">Error</option>
    </select></label>
    <label>Synthetic offer <select value={offer} onChange={event=>setOffer(event.target.value)}><option value="original">Friend €10 / cash €10</option><option value="updated">Friend €15 / cash €20</option></select></label>
    <label><input type="checkbox" checked={savedBank} onChange={event=>setSavedBank(event.target.checked)}/> Synthetic saved bank account</label>
    {surface === "cash" ? <PortalDashboard key={String(savedBank)} data={{...portalData,friendIncentiveMinor:offer==="original"?1000:1500,currentRewardMinor:offer==="original"?1000:2000,
      referralUrl:"https://refer.ph7.health/r/SYNTHETIC-LONG-REVIEW",payoutAccount:savedBank?{id:"synthetic-account",accountMask:"•••• 5432"}:undefined}}
      qrSvg="<svg viewBox='0 0 100 100' aria-hidden='true'></svg>" payoutAction={previewAction} payoutNote="Development-only synthetic preview. No bank details are submitted or stored."/>
      : surface === "withdrawal" ? <section className="payout-section"><PayoutForm key={String(savedBank)} availableBalanceMinor={2000} minimumWithdrawalMinor={1000} savedAccount={savedBank?{id:"synthetic-account",accountMask:"•••• 5432"}:undefined} action={previewAction} /></section>
      : surface === "loading" ? <PortalLoading /> : <PortalError reset={() => setSurface("loading")} />}
    <style>{`.motion-review-reduced .button,.motion-review-reduced summary,.motion-review-reduced .motion-disclosure > summary::after { transition:none; }
      .motion-review-reduced .button:hover,.motion-review-reduced .button:active { transform:none; }`}</style>
  </div>;
}
