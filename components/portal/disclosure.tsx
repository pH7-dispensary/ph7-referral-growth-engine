"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { enhanceDisclosure } from "@/lib/portal/disclosure-motion";

export function Disclosure({ summary, summaryId, className = "", children }: {
  summary: string;
  summaryId?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return enhanceDisclosure(ref.current, window.matchMedia("(prefers-reduced-motion: reduce)"));
  }, []);
  return <details ref={ref} className={`motion-disclosure ${className}`}>
    <summary id={summaryId}>{summary}</summary>
    <div className="disclosure-content">{children}</div>
  </details>;
}
