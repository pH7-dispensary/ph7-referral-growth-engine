import "server-only";

export function referralDemoModeEnabled(): boolean {
  return process.env.REFERRAL_DEMO_MODE === "true" && process.env.APP_ENV === "preview";
}

export function requireReferralDemoMode(): void {
  if (!referralDemoModeEnabled()) throw new Error("Referral demo mode is not enabled.");
}
