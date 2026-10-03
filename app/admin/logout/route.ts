import { NextResponse } from "next/server";
import { adminLoginOriginAllowed } from "@/lib/auth/admin-login-policy";
import { assertSessionCsrf, currentAdminSession, logoutAdminSession } from "@/lib/auth/server";
import { hasAdminAccess } from "@/lib/auth/authorization";
export async function POST(request: Request) {
  try {
    if (!adminLoginOriginAllowed(request)) throw new Error("Rejected");
    const session=await currentAdminSession();
    if (!hasAdminAccess(session)) throw new Error("Rejected");
    if (Number(request.headers.get("content-length") ?? 0)>1024) throw new Error("Rejected");
    const form=await request.formData();
    const token=form.get("csrfToken");
    assertSessionCsrf("ADMIN",session,typeof token==="string"?token:undefined);
    await logoutAdminSession();
    const origin=process.env.NODE_ENV==="production"?"https://refer.ph7.health":new URL(request.url).origin;
    return NextResponse.redirect(new URL("/admin/login",origin),{status:303,headers:{"Cache-Control":"no-store"}});
  } catch {return new Response("Request rejected.",{status:403,headers:{"Cache-Control":"no-store"}});}
}
