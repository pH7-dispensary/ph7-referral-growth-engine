import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReferralSummary } from "@/components/portal/referral-summary";
import type { LedgerEntry } from "@/lib/domain/types";
import { buildPatientPortalData } from "@/lib/portal/data";
import { getSyntheticPatientPortalData } from "@/lib/portal/data";
import { isDevelopmentPatientAccessEnabled } from "@/lib/portal/dev-access";
import { isValidIban, maskIban, payoutRequestSchema } from "@/lib/portal/payout";
import { createReferralQrSvg } from "@/lib/portal/qr";
import { buildReferralUrl } from "@/lib/portal/referral-link";
import { presentReferralStatus } from "@/lib/portal/status";

describe("patient referral portal", () => {
  it("renders referral information and the reward captured on that referral", () => {
    const portal = getSyntheticPatientPortalData();
    const referral = portal.referrals[2];
    const markup = renderToStaticMarkup(<ReferralSummary referral={referral} patientLabel={referral.patientLabel} />);
    expect(markup).toContain("Friend 3");
    expect(markup).toContain("Consultation completed");
    expect(markup).toContain("€15");
  });

  it("keeps historical reward display tied to immutable snapshot values", () => {
    const portal = getSyntheticPatientPortalData();
    expect(portal.currentRewardMinor).toBe(1000);
    expect(portal.referrals[2].economics.referrerRewardMinor).toBe(1500);
    expect(Object.isFrozen(portal.referrals[2].economics)).toBe(true);
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
