import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const cookieName = "ph7_referral_local_admin";
export function developmentAdminEnabled(environment = process.env.NODE_ENV) { return environment === "development"; }
export async function createLocalAdminSession() { if (!developmentAdminEnabled()) throw new Error("Development admin is unavailable."); (await cookies()).set(cookieName, "synthetic-founder", { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 3600 }); }
export async function requireLocalAdmin() { if (!developmentAdminEnabled() || (await cookies()).get(cookieName)?.value !== "synthetic-founder") redirect("/admin"); }
