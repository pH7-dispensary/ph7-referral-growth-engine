import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export const developmentSessionCookie = "ph7_referral_dev_session";
const syntheticSessionValue = "synthetic-ava-referral-user";

export function isDevelopmentPatientAccessEnabled(environment = process.env.NODE_ENV): boolean {
  return environment === "development";
}

export async function createDevelopmentPatientSession(): Promise<void> {
  if (!isDevelopmentPatientAccessEnabled()) throw new Error("Development patient access is unavailable outside development.");
  (await cookies()).set(developmentSessionCookie, syntheticSessionValue, { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 60 * 60 });
}

export async function requireDevelopmentPatientSession(): Promise<void> {
  if (!isDevelopmentPatientAccessEnabled()) redirect("/");
  const session = (await cookies()).get(developmentSessionCookie)?.value;
  if (session !== syntheticSessionValue) redirect("/");
}
