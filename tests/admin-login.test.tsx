import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { adminCredential, FounderPasswordProvider, passwordDigest } from "@/lib/auth/admin-password";
import { adminLoginOriginAllowed } from "@/lib/auth/admin-login-policy";

const mocks = vi.hoisted(() => ({ claim: vi.fn(), begin: vi.fn(), write: vi.fn(), sql: vi.fn() }));
vi.mock("@/lib/auth/admin-login-policy", async importOriginal => ({ ...await importOriginal<object>(), claimAdminLoginAttempt: mocks.claim }));
vi.mock("@/lib/persistence/node-postgres", () => ({ getPostgresExecutor: mocks.sql }));
vi.mock("@/lib/auth/server", () => ({ getReferralSessionService: () => ({ beginAdminSession: mocks.begin }), writeAdminSession: mocks.write, currentAdminSession: async () => null }));
import { POST } from "@/app/admin/login/submit/route";
import AdminLoginPage from "@/app/admin/login/page";

const email = "synthetic-founder@example.test";
const password = "Synthetic-only-password-2026!";
let credential: { version: number; emailHash: string; salt: string; passwordHash: string };
beforeAll(async () => { const salt = "ab".repeat(16); credential = { version: 1, emailHash: createHash("sha256").update(email).digest("hex"), salt, passwordHash: (await passwordDigest(password, salt)).toString("hex") }; });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("ADMIN_LOGIN_CREDENTIAL", JSON.stringify(credential)); vi.stubEnv("NODE_ENV", "production"); mocks.claim.mockResolvedValue(true); mocks.begin.mockResolvedValue({ token: "synthetic-session", csrfToken: "synthetic-csrf" }); });
afterEach(() => vi.unstubAllEnvs());
function request(body = new URLSearchParams({ email, password }).toString(), origin = "https://refer.ph7.health", url = "https://refer.ph7.health/admin/login/submit") { return new Request(url, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body }); }

describe("private founder login", () => {
  it("fails closed for absent or malformed server configuration", () => { expect(adminCredential("")).toBeNull(); expect(adminCredential('{"version":1}')).toBeNull(); expect(adminCredential(JSON.stringify({...credential,version:2}))).toBeNull(); });
  it("verifies the server-configured founder only; browser roles cannot escalate access", async () => { await expect(new FounderPasswordProvider().verifyAdminIdentity({email:email.toUpperCase(),password,role:"ADMIN"})).resolves.toEqual({emailHash:credential.emailHash,role:"FOUNDER"}); });
  it.each([{email,password:"wrong"},{email:"stranger@example.test",password}])("rejects invalid identity or password generically", async input => { await expect(new FounderPasswordProvider().verifyAdminIdentity(input)).rejects.toThrow("Sign-in failed."); });
  it("rejects oversized passwords without KDF work", async () => { await expect(new FounderPasswordProvider().verifyAdminIdentity({email,password:"a".repeat(1025)})).rejects.toThrow(); });
  it("rejects cross-origin, missing-origin and forged local-origin production requests before DB/session writes", async () => { for (const origin of ["https://evil.example","http://localhost:3000",""]) { expect((await POST(request(undefined,origin))).status).toBe(403); } expect(mocks.sql).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); });
  it("rejects cross-site fetches despite a matching origin", () => { const r=request(); r.headers.set("sec-fetch-site","cross-site"); expect(adminLoginOriginAllowed(r)).toBe(false); });
  it("creates a session only after successful identity verification with a fixed redirect", async () => { const response=await POST(request(undefined,undefined,"https://evil.example/admin/login/submit")); expect(response.status).toBe(303); expect(response.headers.get("location")).toBe("https://refer.ph7.health/admin"); expect(response.headers.get("cache-control")).toBe("no-store"); expect(mocks.begin).toHaveBeenCalledWith({emailHash:credential.emailHash,role:"FOUNDER"}); expect(mocks.write).toHaveBeenCalledOnce(); });
  it("failed passwords never create sessions or reflect submitted details", async () => { const response=await POST(request(new URLSearchParams({email,password:"wrong"}).toString())); expect(response.headers.get("location")).toBe("https://refer.ph7.health/admin/login?error=1"); expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); });
  it("enforces durable throttle failure and DB unavailability before password/session work", async () => { mocks.claim.mockResolvedValue(false); await POST(request()); expect(mocks.begin).not.toHaveBeenCalled(); mocks.claim.mockRejectedValue(new Error("synthetic failure")); await POST(request()); expect(mocks.write).not.toHaveBeenCalled(); });
  it("rejects oversized and duplicate form fields", async () => { await POST(request("password="+"a".repeat(4100))); expect(mocks.sql).not.toHaveBeenCalled(); await POST(request(new URLSearchParams([['email',email],['email',email],['password',password]]).toString())); expect(mocks.write).not.toHaveBeenCalled(); });
  it("renders a POST-only login form without prefilled identity, password, hash or registration", async () => { const html=renderToStaticMarkup(await AdminLoginPage({searchParams:Promise.resolve({})})); expect(html).toContain('method="post"'); expect(html).toContain('type="password"'); for(const secret of [email,password,credential.passwordHash,credential.salt])expect(html).not.toContain(secret); expect(html).not.toContain("Sign up"); });
});
