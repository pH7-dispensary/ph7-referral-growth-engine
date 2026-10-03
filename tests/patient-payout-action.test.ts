import { beforeEach, describe, expect, it, vi } from "vitest";
const deps=vi.hoisted(()=>({session:vi.fn(),csrf:vi.fn(),request:vi.fn(),sql:vi.fn(),refresh:vi.fn()}));
vi.mock("@/lib/auth/server",()=>({currentPatientSession:deps.session,assertSessionCsrf:deps.csrf}));
vi.mock("@/lib/portal/patient-payout",()=>({requestPatientCashPayout:deps.request}));
vi.mock("@/lib/persistence/node-postgres",()=>({getPostgresExecutor:deps.sql}));
vi.mock("next/cache",()=>({revalidatePath:deps.refresh}));
import { requestPatientPayout } from "@/lib/portal/actions";
beforeEach(()=>{vi.resetAllMocks();});
describe("patient payout action security",()=>{
  it("rejects missing authentication before financial access",async()=>{
    deps.session.mockResolvedValue(null);
    expect((await requestPatientPayout({status:"idle"},new FormData())).status).toBe("error");
    expect(deps.csrf).not.toHaveBeenCalled();expect(deps.request).not.toHaveBeenCalled();expect(deps.sql).not.toHaveBeenCalled();
  });
  it("rejects an invalid CSRF token before financial access",async()=>{
    deps.session.mockResolvedValue({kind:"PATIENT",referralUserId:"synthetic-user"});
    deps.csrf.mockImplementation(()=>{throw new Error("Rejected");});
    expect((await requestPatientPayout({status:"idle"},new FormData())).status).toBe("error");
    expect(deps.request).not.toHaveBeenCalled();expect(deps.sql).not.toHaveBeenCalled();
  });
  it("uses server-derived patient identity and returns only safe confirmation",async()=>{
    const session={kind:"PATIENT",referralUserId:"synthetic-user"};deps.session.mockResolvedValue(session);
    deps.request.mockResolvedValue({id:"synthetic-payout",status:"REQUESTED"});
    const form=new FormData();form.set("csrfToken","synthetic-csrf");form.set("referralUserId","attacker-override");
    const result=await requestPatientPayout({status:"idle"},form);
    expect(deps.csrf).toHaveBeenCalledWith("PATIENT",session,"synthetic-csrf");
    expect(deps.request.mock.calls[0][1]).toEqual(session);
    expect(result.status).toBe("success");expect(JSON.stringify(result)).not.toContain("synthetic-payout");
    expect(deps.refresh).toHaveBeenCalledWith("/portal");
  });
  it("never echoes bank values or database diagnostics on failure",async()=>{
    deps.session.mockResolvedValue({kind:"PATIENT",referralUserId:"synthetic-user"});
    deps.request.mockRejectedValue(new Error("sensitive database diagnostic"));
    const result=await requestPatientPayout({status:"idle"},new FormData());
    expect(result.status).toBe("error");expect(result.message).not.toContain("sensitive database diagnostic");
  });
  it("does not describe a replayed paid withdrawal as pending review",async()=>{
    deps.session.mockResolvedValue({kind:"PATIENT",referralUserId:"synthetic-user"});
    deps.request.mockResolvedValue({id:"synthetic-payout",status:"PAID",accountMask:"•••• 5432"});
    expect(await requestPatientPayout({status:"idle"},new FormData())).toMatchObject({status:"success",payoutStatus:"PAID",accountMask:"•••• 5432"});
  });
  it("does not report a cancelled replay as a successful new request",async()=>{
    deps.session.mockResolvedValue({kind:"PATIENT",referralUserId:"synthetic-user"});
    deps.request.mockResolvedValue({id:"synthetic-payout",status:"CANCELLED"});
    expect((await requestPatientPayout({status:"idle"},new FormData())).status).toBe("error");
  });
});
