import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PortalDashboard } from "@/components/portal/portal-dashboard";
import { PayoutForm } from "@/components/portal/payout-form";
import { getSyntheticPatientPortalData } from "@/lib/portal/data";
import { decryptPayoutIban, encryptPayoutIban, payoutStorageConfigured } from "@/lib/portal/payout-encryption";
import { requestPatientCashPayout } from "@/lib/portal/patient-payout";
import { navigateToPortalSection } from "@/lib/portal/section-navigation";
import type { SqlExecutor } from "@/lib/persistence/postgres";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("cash offer and withdrawal presentation", () => {
  it.each([[1000,1000,"Give €10.","Get €10 cash."],[1500,2000,"Give €15.","Get €20 cash."]])("renders live offer %i/%i without changing history", (friend,reward,give,get) => {
    const data = { ...getSyntheticPatientPortalData(), friendIncentiveMinor:friend as number, currentRewardMinor:reward as number };
    const html = renderToStaticMarkup(<PortalDashboard data={data} qrSvg="<svg/>" />);
    expect(html).toContain(give); expect(html).toContain(get);
    expect(html).toContain("in cash after they complete and pay for it.");
    expect(html).toContain("Referral rewards are paid to you in cash, not pH7 credit.");
    expect(data.referrals[0].economics.referrerRewardMinor).toBe(1000);
    expect(data.availableBalanceMinor).toBe(2000);
  });
  it("confirms only masked saved details and supports replacing the account", () => {
    const html = renderToStaticMarkup(<PayoutForm availableBalanceMinor={2000} minimumWithdrawalMinor={1000} savedAccount={{id:"account",accountMask:"•••• 5432"}} action={async()=>({status:"success"})} />);
    expect(html).toContain("•••• 5432"); expect(html).toContain("Use another bank account");
    expect(html).not.toContain('name="iban"'); expect(html).not.toContain('name="accountHolderName"');
    expect(html).toContain("Confirm withdrawal");
  });
  it("does not advertise reserved cash as withdrawable", () => {
    const data = {...getSyntheticPatientPortalData(), withdrawableBalanceMinor:0};
    const html = renderToStaticMarkup(<PortalDashboard data={data} qrSvg="<svg/>" payoutAction={async()=>({status:"success"})}/>);
    expect(html).not.toContain("withdrawal-cta"); expect(html).toContain("Withdrawal information");
    expect(html).toContain('href="#rewards"'); expect(html).toContain('id="rewards" tabindex="-1"');
    expect(html).toContain('href="#activity"'); expect(html).toContain('id="activity" tabindex="-1"');
  });
  it("does not enable withdrawals while fraud review is pending",()=>{
    const data={...getSyntheticPatientPortalData(),withdrawalUnderReview:true};
    const html=renderToStaticMarkup(<PortalDashboard data={data} qrSvg="<svg/>" payoutAction={async()=>({status:"success"})}/>);
    expect(html).not.toContain("withdrawal-cta");expect(html).toContain("Withdrawals are under review.");expect(html).toContain("disabled=");
  });
});
describe("secure bank storage", () => {
  const key = "1".repeat(64), iban = "GB82WEST12345698765432";
  it("encrypts with random IVs, authenticates and binds to the patient", () => {
    const first = encryptPayoutIban(iban,"user-a",key), second = encryptPayoutIban(iban,"user-a",key);
    expect(first.equals(second)).toBe(false); expect(first.includes(Buffer.from(iban))).toBe(false);
    expect(decryptPayoutIban(first,"user-a",key)).toBe(iban);
    expect(()=>decryptPayoutIban(first,"user-b",key)).toThrow();
    first[first.length-1] ^= 1; expect(()=>decryptPayoutIban(first,"user-a",key)).toThrow();
  });
  it("fails closed without a valid key",()=> {
    vi.stubEnv("PAYOUT_DATA_ENCRYPTION_KEY",""); expect(payoutStorageConfigured()).toBe(false);
    vi.stubEnv("PAYOUT_DATA_ENCRYPTION_KEY","invalid"); expect(payoutStorageConfigured()).toBe(false);
    vi.stubEnv("PAYOUT_DATA_ENCRYPTION_KEY",key); expect(payoutStorageConfigured()).toBe(true);
  });
  it("rejects unauthenticated requests before database access",async()=> {
    const query = vi.fn(); const sql = {query,transaction:vi.fn()} as unknown as SqlExecutor;
    await expect(requestPatientCashPayout(sql,null,new FormData())).rejects.toThrow("authorisation");
    expect(query).not.toHaveBeenCalled(); expect(sql.transaction).not.toHaveBeenCalled();
  });
  it("collects no bank data in persistence when secure storage is unavailable",async()=> {
    vi.stubEnv("PAYOUT_DATA_ENCRYPTION_KEY","");
    const query=vi.fn(),transaction=vi.fn();
    const session={kind:"PATIENT" as const,referralUserId:"synthetic-user",id:"synthetic-session",tokenHash:"synthetic",csrfTokenHash:"synthetic",expiresAt:new Date(Date.now()+1000),invalidatedAt:null};
    await expect(requestPatientCashPayout({query,transaction} as unknown as SqlExecutor,session,new FormData())).rejects.toThrow("Secure payout storage");
    expect(transaction).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
  });
});
describe("in-page navigation",()=> {
  it.each([false,true])("moves focus, offsets sticky header and respects reduced motion=%s",reduced=> {
    const focus=vi.fn(),replaceState=vi.fn(),scrollTo=vi.fn();
    const header={getBoundingClientRect:()=>({bottom:72})};
    const target={focus,getBoundingClientRect:()=>({top:600}),closest:()=>({querySelector:()=>header})};
    vi.stubGlobal("document",{getElementById:()=>target});
    vi.stubGlobal("getComputedStyle",(el:unknown)=>({position:el===header?"sticky":"static",scrollMarginTop:"24px"}));
    vi.stubGlobal("history",{replaceState}); vi.stubGlobal("window",{scrollY:100,scrollTo,matchMedia:()=>({matches:reduced})});
    expect(navigateToPortalSection("rewards")).toBe(true);
    expect(focus).toHaveBeenCalledWith({preventScroll:true}); expect(replaceState).toHaveBeenCalledWith(null,"","#rewards");
    expect(scrollTo).toHaveBeenCalledWith({top:612,behavior:reduced?"instant":"smooth"});
    navigateToPortalSection("rewards"); expect(scrollTo).toHaveBeenCalledTimes(2);
  });
  it("preserves fallback navigation if the target is absent",()=> {
    vi.stubGlobal("document",{getElementById:()=>null}); expect(navigateToPortalSection("absent")).toBe(false);
  });
});
