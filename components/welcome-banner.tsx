"use client";

export function WelcomeBanner({
  onDismiss,
  onOpenProviders,
}: {
  onDismiss: () => void;
  onOpenProviders: () => void;
}) {
  return (
    <div className="welcome-banner">
      <div className="welcome-body">
        <strong>Welcome to AI Cinema.</strong>
        <span>
          Free preview: Pollinations stills (now rate-limited — 1 queued request per IP, retries until they let you through) +
          Ken Burns motion on top. Title cards + ffmpeg.wasm render still work fully without a key.
        </span>
        <span>
          For reliable generation, add a Replicate key via 🔑 Keys to unlock Flux, MiniMax video, and the rest, or sign up at
          enter.pollinations.ai for a Pollinations token. Try a
          starter from ⚀ Templates to see the timeline come to life.
        </span>
      </div>
      <div className="welcome-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            onDismiss();
            onOpenProviders();
          }}
        >
          🔑 Add a key
        </button>
        <button type="button" className="btn ghost" onClick={onDismiss}>
          ✕ Got it
        </button>
      </div>
    </div>
  );
}
