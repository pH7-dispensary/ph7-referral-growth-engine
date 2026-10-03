"use client";

import { useEffect, useRef, useState } from "react";
import { createActionFeedback, type ShareConfirmation } from "@/lib/portal/action-feedback";

function ActionLabel({ label, confirmation, confirmed }: { label: string; confirmation: string; confirmed: boolean }) {
  return <span className="action-label">
    <span aria-hidden={confirmed}>{label}</span>
    <span aria-hidden={!confirmed}>{confirmation}</span>
  </span>;
}

export function ShareActions({ referralUrl, shareText = "I've been using pH7 and thought you might find it useful.", compact = false }: { referralUrl: string; shareText?: string; compact?: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ShareConfirmation | null>(null);
  const feedback = useRef<ReturnType<typeof createActionFeedback> | null>(null);
  if (feedback.current === null) feedback.current = createActionFeedback((source, text) => {
    setConfirmation(source);
    setMessage(text);
  });
  const sharing = useRef(false);
  useEffect(() => () => {
    feedback.current?.dispose();
  }, []);
  const whatsAppHref = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralUrl}`)}`;

  async function copyLink(source: "copy" | "share-copy" = "copy") {
    const id = feedback.current!.begin();
    try {
      await navigator.clipboard.writeText(referralUrl);
      feedback.current!.confirm(id, source, "Link copied");
    } catch {
      if (!feedback.current!.current(id)) return;
      setConfirmation(null);
      setMessage("Copy is unavailable. Select the link above to copy it.");
    }
  }

  async function shareLink() {
    if (sharing.current) return;
    if (!navigator.share) {
      await copyLink("share-copy");
      return;
    }
    sharing.current = true;
    const id = feedback.current!.begin();
    setConfirmation(null);
    setMessage(null);
    try {
      await navigator.share({ title: "pH7 Refer", text: shareText, url: referralUrl });
      feedback.current!.confirm(id, "share", "Thanks for sharing");
    } catch (error) {
      if (!feedback.current!.current(id)) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setConfirmation(null);
      setMessage("Sharing is unavailable. You can copy the link instead.");
    } finally {
      sharing.current = false;
    }
  }

  return (
    <div className={compact ? "share-actions share-actions-compact" : "share-actions"}>
      <button className="button button-dark share-primary" onClick={shareLink} type="button"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8" /></svg><ActionLabel label="Share invite" confirmation={confirmation === "share-copy" ? "Link copied ✓" : "Invite shared ✓"} confirmed={confirmation === "share" || confirmation === "share-copy"} /></button>
      <button className="button button-soft" data-confirmed={confirmation === "copy"} onClick={() => copyLink()} type="button"><ActionLabel label="Copy link" confirmation="Copied ✓" confirmed={confirmation === "copy"} /></button>
      <a className="button button-whatsapp" href={whatsAppHref} rel="noopener noreferrer" target="_blank">WhatsApp</a>
      <p role="status" aria-live="polite" className={`action-message${confirmation || !message ? " sr-only" : ""}`}>{message}</p>
    </div>
  );
}
