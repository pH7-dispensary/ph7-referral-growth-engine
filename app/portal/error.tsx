"use client";

export default function PortalError({ reset }: { reset: () => void }) {
  return (
    <main className="entry-shell portal-state">
      <section className="entry-card" role="alert">
        <p className="eyebrow">pH7 Refer</p>
        <h1 className="portal-state-title">We couldn’t load your referral space.</h1>
        <p className="entry-copy">Please try again. If this keeps happening, reopen pH7 Refer from the pH7 app.</p>
        <button className="button button-dark button-full" onClick={reset} type="button">Try again</button>
      </section>
    </main>
  );
}
