"use client";

import { useState } from "react";

export function ShareActions({ referralUrl }: { referralUrl: string }) {
  const [message, setMessage] = useState<string | null>(null);

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
      await navigator.share({ title: "Try pH7", text: "Here is my pH7 invitation.", url: referralUrl });
      setMessage("Thanks for sharing");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("Sharing is unavailable. You can copy the link instead.");
    }
  }

  return (
    <div className="share-actions">
      <button className="button button-dark" onClick={copyLink} type="button">Copy link</button>
      <button className="button button-soft" onClick={shareLink} type="button">Share invitation</button>
      <p aria-live="polite" className="action-message">{message}</p>
    </div>
  );
}
