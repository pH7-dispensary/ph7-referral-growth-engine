/**
 * Patient App HTTPS return link, with web fallback if native routing is unavailable.
 * Keep this a normal same-tab anchor so the OS can handle verified app links.
 * A web page cannot dismiss its native container without a supported app bridge.
 * Never use the handoff issuer, browser history, logout or a caller-provided URL.
 */
export function BackToPh7() {
  return <a className="portal-back" href="https://patients.ph7.health/en/home" aria-label="Back to pH7" title="Back to pH7" referrerPolicy="no-referrer">
    <span className="portal-back-mobile" aria-hidden="true">×</span>
    <span className="portal-back-desktop" aria-hidden="true">← Back to pH7</span>
  </a>;
}
