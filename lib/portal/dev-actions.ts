"use server";

import { redirect } from "next/navigation";
import { createDevelopmentPatientSession } from "@/lib/portal/dev-access";

export async function beginDevelopmentPatientSession(): Promise<never> {
  await createDevelopmentPatientSession();
  redirect("/portal");
}
