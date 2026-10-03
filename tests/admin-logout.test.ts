import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({current:vi.fn(),csrf:vi.fn(),logout:vi.fn()}));
vi.mock("@/lib/auth/server",()=>({currentAdminSession:mocks.current,assertSessionCsrf:mocks.csrf,logoutAdminSession:mocks.logout}));
import { POST } from "@/app/admin/logout/route";
beforeEach(()=>{vi.clearAllMocks();mocks.current.mockResolvedValue({kind:"ADMIN",adminUserId:"synthetic",adminRole:"FOUNDER"});});
function request(origin="http://localhost:3000",token="synthetic-csrf"){return new Request("http://localhost:3000/admin/logout",{method:"POST",headers:{origin,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrfToken:token})});}
describe("admin-only sign-out",()=>{
  it("requires same-origin request before session changes",async()=>{expect((await POST(request("https://evil.example"))).status).toBe(403);expect(mocks.logout).not.toHaveBeenCalled();});
  it("rejects patient sessions",async()=>{mocks.current.mockResolvedValue({kind:"PATIENT"});expect((await POST(request())).status).toBe(403);expect(mocks.logout).not.toHaveBeenCalled();});
  it("rejects invalid CSRF before logout",async()=>{mocks.csrf.mockImplementation(()=>{throw new Error("Rejected");});expect((await POST(request())).status).toBe(403);expect(mocks.logout).not.toHaveBeenCalled();});
  it("ends only the existing admin session after CSRF validation",async()=>{mocks.csrf.mockImplementation(()=>{});const result=await POST(request());expect(result.status).toBe(303);expect(mocks.logout).toHaveBeenCalledOnce();expect(mocks.csrf).toHaveBeenCalledWith("ADMIN",expect.objectContaining({kind:"ADMIN"}),"synthetic-csrf");});
});
