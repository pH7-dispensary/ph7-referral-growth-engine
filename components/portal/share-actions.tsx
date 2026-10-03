"use client";

import { useState } from "react";

export function ShareActions({ referralUrl, shareText = "I've been using pH7 and thought you might find it useful.", compact = false }: { referralUrl: string; shareText?: string; compact?: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const whatsAppHref = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralUrl}`)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setMessage("Link copied");
    } catch {
      setMessage("Copy is unavailable. Select the link above to copy it.");
    }
  }

  async function shareLink() {
    if (!navigator.share) {
      await copyLink();
      return;
    }
    try {
      await navigator.share({ title: "pH7 Refer", text: shareText, url: referralUrl });
      setMessage("Thanks for sharing");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("Sharing is unavailable. You can copy the link instead.");
    }
  }

  return (
    <div className={compact ? "share-actions share-actions-compact" : "share-actions"}>
      <button className="button button-dark" onClick={shareLink} type="button">Share invite</button>
      <button className="button button-soft" onClick={copyLink} type="button">Copy link</button>
      <a className="button button-whatsapp" href={whatsAppHref} rel="noopener noreferrer" target="_blank">WhatsApp</a>
      <p aria-live="polite" className="action-message">{message}</p>
    </div>
  );
}
