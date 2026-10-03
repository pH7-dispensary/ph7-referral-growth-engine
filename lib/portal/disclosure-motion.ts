/** Presentation-only enhancement of native details. No application state or IO.
 * A short, deliberate disclosure height tween keeps neighbouring content in
 * place. Measurements happen once per intent, never in a React/frame loop.
 */
export function enhanceDisclosure(details: HTMLDetailsElement, preference: MediaQueryList) {
  const summary = details.querySelector("summary");
  const panel = details.querySelector<HTMLElement>(".disclosure-content");
  if (!summary || !panel) return () => undefined;
  let expanded = details.open;
  let animation: Animation | undefined;

  function cancel() {
    if (animation) {
      animation.onfinish = null;
      animation.cancel();
      animation = undefined;
    }
  }
  function announce() {
    details.dataset.expanded = String(expanded);
    summary!.setAttribute("aria-expanded", String(expanded));
    panel!.inert = !expanded;
    panel!.setAttribute("aria-hidden", String(!expanded));
  }
  function settle() {
    cancel();
    details.open = expanded;
    panel!.style.height = "";
    panel!.style.overflow = "";
    announce();
  }
  function toggle(event: MouseEvent) {
    event.preventDefault();
    // Native details may retain the hidden child's layout box. Closed means
    // visually zero, regardless of that cached rectangle (notably Chromium).
    const currentHeight = details.open ? panel!.getBoundingClientRect().height : 0;
    cancel();
    expanded = !expanded;
    if (!expanded && panel!.contains(document.activeElement)) summary!.focus();
    announce();
    if (preference.matches || typeof panel!.animate !== "function") {
      settle();
      return;
    }
    // Keep the native content mounted during exit; the summary remains usable
    // and announces the user's intent immediately, including during a reversal.
    details.open = true;
    panel!.style.height = "";
    const targetHeight = expanded ? panel!.scrollHeight : 0;
    panel!.style.height = `${targetHeight}px`;
    panel!.style.overflow = "hidden";
    animation = panel!.animate(
      [{ height: `${currentHeight}px` }, { height: `${targetHeight}px` }],
      { duration: expanded ? 180 : 130, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    animation.onfinish = settle;
  }
  function nativeToggle() {
    if (animation) return;
    expanded = details.open;
    announce();
  }
  announce();
  summary.addEventListener("click", toggle);
  details.addEventListener("toggle", nativeToggle);
  preference.addEventListener("change", settle);
  window.addEventListener("resize", settle);
  return () => {
    settle();
    summary.removeEventListener("click", toggle);
    details.removeEventListener("toggle", nativeToggle);
    preference.removeEventListener("change", settle);
    window.removeEventListener("resize", settle);
  };
}
