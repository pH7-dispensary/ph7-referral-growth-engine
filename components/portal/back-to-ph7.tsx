/** Use the existing Patient App origin; never history, logout or a caller-provided URL. */
export function BackToPh7() {
  return <a className="portal-back" href="https://app.ph7.health/" aria-label="Back to pH7" title="Back to pH7" referrerPolicy="no-referrer">
    <span className="portal-back-mobile" aria-hidden="true">×</span>
    <span className="portal-back-desktop" aria-hidden="true">← Back to pH7</span>
  </a>;
}
