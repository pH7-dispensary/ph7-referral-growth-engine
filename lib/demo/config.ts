import "server-only";

export function referralDemoModeEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  // A production deployment must never render, seed, or mutate the synthetic
  // review environment, even if preview flags were copied into Vercel by
  // mistake. VERCEL_ENV is platform-owned and therefore the final boundary.
  if (environment.VERCEL_ENV === "production" || environment.APP_ENV === "production") return false;
  return environment.REFERRAL_DEMO_MODE === "true" && environment.APP_ENV === "preview";
}

export function requireReferralDemoMode(): void {
  if (!referralDemoModeEnabled()) throw new Error("Referral demo mode is not enabled.");
}
