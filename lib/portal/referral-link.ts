const referralCodePattern = /^[A-Z0-9-]{6,24}$/;

export function buildReferralUrl(code: string, origin = "http://localhost:3000"): string {
  if (!referralCodePattern.test(code)) throw new Error("Referral code has an invalid format.");
  const url = new URL(`/r/${code}`, origin);
  return url.toString();
}
