"use client";

import type { ReactNode } from "react";
import { navigateToPortalSection } from "@/lib/portal/section-navigation";

export function SectionLink({ target, children, className }: { target: string; children: ReactNode; className?: string }) {
  return <a href={`#${target}`} className={className} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // Keep the native href as a no-JavaScript fallback and for modified clicks.
    if (document.getElementById(target)) { event.preventDefault(); navigateToPortalSection(target); }
  }}>{children}</a>;
}
