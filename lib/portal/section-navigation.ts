/** Enhance same-page links without relying on a webview's default URL navigation. */
export function navigateToPortalSection(id: string): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  const header = target.closest(".portal-shell")?.querySelector(".portal-header");
  const position = header ? getComputedStyle(header).position : "static";
  const offset = header && (position === "fixed" || position === "sticky")
    ? Math.max(0, header.getBoundingClientRect().bottom) + 16
    : parseFloat(getComputedStyle(target).scrollMarginTop) || 24;
  target.focus({ preventScroll: true });
  history.replaceState(null, "", `#${id}`);
  window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset),
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  return true;
}
