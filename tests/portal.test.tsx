import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReferralSummary } from "@/components/portal/referral-summary";
import { PortalDashboard } from "@/components/portal/portal-dashboard";
import { PayoutForm } from "@/components/portal/payout-form";
import type { LedgerEntry } from "@/lib/domain/types";
import { buildPatientPortalData } from "@/lib/portal/data";
import { getSyntheticPatientPortalData } from "@/lib/portal/data";
import { isDevelopmentPatientAccessEnabled } from "@/lib/portal/dev-access";
import { isValidIban, maskIban, payoutRequestSchema } from "@/lib/portal/payout";
import { createReferralQrSvg } from "@/lib/portal/qr";
import { buildReferralUrl } from "@/lib/portal/referral-link";
import { presentReferralStatus } from "@/lib/portal/status";

describe("patient referral portal", () => {
  it("renders campaign values, holding period and an actionable empty referral state", () => {
    const portal = { ...getSyntheticPatientPortalData(), friendIncentiveMinor: 750, currentRewardMinor: 1250, holdingPeriodDays: 9, referrals: [], payouts: [] };
    const markup = renderToStaticMarkup(<PortalDashboard data={portal} qrSvg="<svg />" />);
    expect(markup).toContain("Give €7.50.");
    expect(markup).toContain("Get €12.50 cash.");
    expect(markup).toContain("9-day holding period");
    expect(markup).toContain("No referrals yet.");
    expect(markup).toContain("Share invite");
    expect(markup).toContain("Your payout requests will appear here.");
    expect(markup).not.toContain('name="iban"');
  });

  it("only asks for bank details when an existing withdrawal action is available", () => {
    const props = { availableBalanceMinor: 2000, minimumWithdrawalMinor: 1000 };
    const unavailable = renderToStaticMarkup(<PayoutForm {...props} />);
    expect(unavailable).toContain("Online withdrawals are not available yet.");
    expect(unavailable).not.toContain('name="iban"');
    const available = renderToStaticMarkup(<PayoutForm {...props} action={async () => ({ status: "success", message: "Synthetic request accepted" })} />);
    expect(available).toContain('name="iban"');
    expect(available).toContain('aria-describedby="withdrawal-eligibility"');
    expect(available).not.toContain("disabled=");
  });
  it("renders referral information and the reward captured on that referral", () => {
    const portal = getSyntheticPatientPortalData();
    const referral = portal.referrals[2];
    const markup = renderToStaticMarkup(<ReferralSummary referral={referral} patientLabel={referral.patientLabel} />);
    expect(markup).toContain("Friend 3");
    expect(markup).toContain("Qualification pending");
    expect(markup).toContain("€15 potential reward");
    expect(markup).toContain("€15");
  });

  it("keeps historical reward display tied to immutable snapshot values", () => {
    const portal = getSyntheticPatientPortalData();
    expect(portal.currentRewardMinor).toBe(1000);
    expect(portal.referrals[2].economics.referrerRewardMinor).toBe(1500);
    expect(Object.isFrozen(portal.referrals[2].economics)).toBe(true);
  });

  it("shows an associated withdrawal action only when the existing payout action is usable", () => {
    const data = getSyntheticPatientPortalData();
    const action = async () => ({ status: "success" as const, message: "Synthetic request accepted" });
    const ready = renderToStaticMarkup(<PortalDashboard data={data} qrSvg="<svg />" payoutAction={action} />);
    expect(ready).toContain("Withdraw cash");
    expect(ready).not.toContain("Development preview");
    const belowMinimum = renderToStaticMarkup(<PortalDashboard data={{...data, availableBalanceMinor:500}} qrSvg="<svg />" payoutAction={action} />);
    expect(belowMinimum).toContain("Withdrawals start at €10.");
    expect(belowMinimum).not.toContain('withdrawal-cta');
    const unavailable = renderToStaticMarkup(<PortalDashboard data={data} qrSvg="<svg />" />);
    expect(unavailable).not.toContain('withdrawal-cta');
    expect(unavailable).toContain("Online withdrawals are not available yet.");
  });

  it("reads per-referral reward evidence from the ledger without changing totals or snapshots", () => {
    const data = getSyntheticPatientPortalData();
    expect(data.referrals[0].ledgerCredit).toMatchObject({status:"EFFECTIVE",amountMinor:1000});
    expect(data.referrals[1].ledgerCredit).toMatchObject({status:"PENDING",amountMinor:1000});
    expect(data.referrals[2].ledgerCredit).toBeUndefined();
    expect(data.availableBalanceMinor).toBe(2000);
    expect(data.pendingBalanceMinor).toBe(1000);
    expect(data.totalEarnedMinor).toBe(4000);
    expect(data.referrals[2].economics.referrerRewardMinor).toBe(1500);
  });

  it.each([
    ["PAYABLE", "EFFECTIVE", false, "€10 cash available"],
    ["QUALIFIED", "PENDING", false, "€10 cash pending"],
    ["FRAUD_REVIEW", undefined, false, "€15 under review"],
    ["REFUNDED", "EFFECTIVE", true, "Reward reversed"],
    ["CANCELLED", undefined, false, "No reward payable"],
    ["PAID_OUT", "EFFECTIVE", false, "€10 paid"],
    ["PAID", undefined, false, "€15 potential reward"],
    ["PAYABLE", undefined, false, "€15 potential reward"],
  ] as const)("makes %s reward presentation explicit without inventing an available balance", (state, creditStatus, reversed, expected) => {
    const original = getSyntheticPatientPortalData().referrals[2];
    const referral = {...original,status:state,ledgerCredit: creditStatus ? {status:creditStatus,amountMinor:1000} : undefined,hasLedgerReversal:reversed};
    const markup = renderToStaticMarkup(<ReferralSummary referral={referral} patientLabel={referral.patientLabel} />);
    expect(markup).toContain(expected);
  });

  it("translates internal referral states into patient-friendly presentation", () => {
    expect(presentReferralStatus("QUALIFIED")).toMatchObject({ label: "Reward pending", tone: "pending" });
    expect(presentReferralStatus("FRAUD_REVIEW")).toMatchObject({ label: "Under review", tone: "review" });
    expect(presentReferralStatus("REFUNDED").detail).not.toContain("FRAUD_REVIEW");
  });

  it("creates a deterministic local referral link and a QR SVG from it", async () => {
    const link = buildReferralUrl("PH7-AVA-72");
    expect(link).toBe("http://localhost:3000/r/PH7-AVA-72");
    expect(buildReferralUrl("PH7DEMO", "https://ph7-referral-growth-engine.vercel.app")).toBe("https://ph7-referral-growth-engine.vercel.app/r/PH7DEMO");
    await expect(createReferralQrSvg(link)).resolves.toContain("<svg");
    expect(() => buildReferralUrl("not a valid code")).toThrow("invalid format");
  });

  it("calculates portal balances from integer minor units without string concatenation", () => {
    const now = new Date("2026-09-23T10:00:00.000Z");
    const base = { id: "ledger", referralId: "ref", payoutRequestId: null, currency: "EUR" as const, status: "EFFECTIVE" as const, idempotencyKey: "key", effectiveAt: now, createdAt: now };
    const ledger = [
      { ...base, id: "credit-1", type: "CREDIT", amountMinor: "1000" },
      { ...base, id: "credit-2", type: "CREDIT", amountMinor: "1000" },
      { ...base, id: "payout", referralId: null, payoutRequestId: "payout-1", type: "PAYOUT", amountMinor: "-500" },
      { ...base, id: "reversal", type: "REVERSAL", amountMinor: "-1000" },
      { ...base, id: "pending", type: "CREDIT", amountMinor: "1000", status: "PENDING", effectiveAt: null },
    ] as unknown as LedgerEntry[];
    const totals = buildPatientPortalData([], ledger);
    expect(totals.availableBalanceMinor).toBe(500);
    expect(totals.pendingBalanceMinor).toBe(1000);
    expect(totals.totalEarnedMinor).toBe(3000);
  });

  it("only enables synthetic patient access in development", () => {
    expect(isDevelopmentPatientAccessEnabled("development")).toBe(true);
    expect(isDevelopmentPatientAccessEnabled("production")).toBe(false);
    expect(isDevelopmentPatientAccessEnabled("test")).toBe(false);
  });
});

describe("payout detail handling", () => {
  const validInput = {
    accountHolderName: "Ava Test",
    iban: "GB82 WEST 1234 5698 7654 32",
    amountMinor: 1000,
    availableBalanceMinor: 2000,
    minimumWithdrawalMinor: 1000,
  };

  it("validates IBANs and does not expose their full value in display text", () => {
    expect(isValidIban(validInput.iban)).toBe(true);
    expect(isValidIban("GB00 WEST 1234 5698 7654 32")).toBe(false);
    expect(maskIban(validInput.iban)).toBe("•••• 5432");
    expect(maskIban(validInput.iban)).not.toContain("GB82");
  });

  it("rejects payout requests below the minimum, above the balance, or with invalid account data", () => {
    expect(payoutRequestSchema.safeParse(validInput).success).toBe(true);
    expect(payoutRequestSchema.safeParse({ ...validInput, amountMinor: 500 }).success).toBe(false);
    expect(payoutRequestSchema.safeParse({ ...validInput, amountMinor: 3000 }).success).toBe(false);
    expect(payoutRequestSchema.safeParse({ ...validInput, iban: "PT00 not-an-iban" }).success).toBe(false);
  });
});
