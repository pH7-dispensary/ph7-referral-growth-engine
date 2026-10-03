const localFallback = "http://localhost:3000";
const productionOrigin = "https://refer.ph7.health";

function isLocalHttp(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
}

export function referralPublicOrigin(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const configured = environment.REFERRAL_PUBLIC_URL?.trim();
  const vercelUrl = environment.VERCEL_URL?.trim();
  const production = environment.APP_ENV === "production" || environment.VERCEL_ENV === "production";
  const raw = configured || (production ? productionOrigin : vercelUrl ? `https://${vercelUrl}` : localFallback);
  const url = new URL(raw);
  if (url.username || url.password || url.hash || url.search) throw new Error("REFERRAL_PUBLIC_URL must not contain credentials, query, or fragment.");
  if (url.protocol !== "https:" && !isLocalHttp(url)) throw new Error("REFERRAL_PUBLIC_URL must be HTTPS outside local development.");
  if (production && url.origin !== productionOrigin) throw new Error("Production referral URLs require the canonical pH7 Refer origin.");
  return url.origin;
}
