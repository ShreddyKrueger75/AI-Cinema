"use client";

// Route-level error boundary (Next.js convention). A runtime error anywhere
// in the editor lands here instead of white-screening the tab. Project state
// lives in localStorage (zustand persist) + IndexedDB, so a reload loses
// nothing — say so, loudly.

export default function EditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">// SOMETHING BROKE</h1>
        <p className="auth-sub">
          The editor hit an unexpected error. Your project is saved locally —
          reloading will not lose your work.
        </p>
        <div className="auth-error">⚠ {error.message || "Unknown error"}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button type="button" className="btn primary" onClick={() => reset()}>
            Try again
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => window.location.reload()}
          >
            Reload the editor
          </button>
        </div>
      </div>
    </main>
  );
}
