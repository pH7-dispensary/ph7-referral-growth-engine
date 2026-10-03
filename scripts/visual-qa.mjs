/** Read-only DOM checks. Run in a rendered browser using auditVisualUi.toString().
 * Complements screenshot/keyboard review; not a full WCAG certification.
 */
export function auditVisualUi() {
  const root = document.querySelector('main');
  if (!root) return { error: 'No main landmark' };
  const findings = [];
  const visible = (el) => {
    // Screen-reader-only live announcements are intentionally not visual UI.
    if (el.closest('.sr-only')) return false;
    const closedDetails = el.closest('details:not([open])');
    if (closedDetails && el !== closedDetails && !el.closest('summary')) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const rgb = (color) => {
    const parts = color.match(/[\d.]+/g)?.map(Number);
    return parts && parts.length >= 3 ? parts : null;
  };
  const luminance = (color) => color.slice(0, 3).map(v => {
    const n = v / 255;
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el) || el.closest('[disabled]')) continue;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const label = (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 80);
    if (rect.right > document.documentElement.clientWidth + 1 && !el.closest('.admin-nav')) {
      findings.push({ type: 'viewport-overflow', label });
    }
    if (['hidden', 'clip'].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 2 && el.textContent.trim()) {
      findings.push({ type: 'clipped-content', label });
    }
    const hasText = Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (hasText) {
      const size = Number.parseFloat(style.fontSize);
      if (size < 12) findings.push({ type: 'tiny-text', label, size });
      const foreground = rgb(style.color);
      let ancestor = el;
      let background = null;
      while (ancestor && !background) {
        const color = rgb(getComputedStyle(ancestor).backgroundColor);
        if (color && (color.length === 3 || color[3] === 1)) background = color;
        ancestor = ancestor.parentElement;
      }
      // Transparent/gradient surfaces are approximated as white; review screenshots too.
      background ??= [255, 255, 255];
      if (foreground) {
        const a = luminance(foreground), b = luminance(background);
        const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        const large = size >= 24 || (size >= 18.66 && Number.parseInt(style.fontWeight, 10) >= 700);
        if (ratio < (large ? 3 : 4.5)) findings.push({ type: 'text-contrast', label, ratio: +ratio.toFixed(2) });
      }
    }
    if (el.matches('button,a,summary,input:not([type="hidden"]),select,textarea')) {
      if (rect.height < 44 || rect.width < 44) findings.push({ type: 'small-target', label, width: rect.width, height: rect.height });
      if (!el.getAttribute('aria-label') && !el.textContent.trim() && !el.labels?.length) findings.push({ type: 'missing-label', label });
    }
    if (el.matches('img:not([alt])')) findings.push({ type: 'missing-alt', label });
  }
  return {
    viewport: { width: innerWidth, height: innerHeight },
    pageHeight: document.documentElement.scrollHeight,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    findings,
  };
}
