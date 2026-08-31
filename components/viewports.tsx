"use client";

import { useToasts } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";

/* ───────────── TOAST VIEWPORT ───────────── */

export function ConfirmViewport() {
  const prompt = useConfirm((s) => s.prompt);
  const resolve = useConfirm((s) => s.resolve);
  const resolveAlt = useConfirm((s) => s.resolveAlt);
  const cancel = useConfirm((s) => s.cancel);
  if (!prompt) return null;
  const titleId = `confirm-title-${prompt.id}`;
  const messageId = `confirm-message-${prompt.id}`;
  return (
    <div
      className="modal-overlay"
      onClick={cancel}
      role="alertdialog"
      aria-modal
      aria-labelledby={titleId}
      aria-describedby={messageId}
    >
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title" id={titleId}>{prompt.title}</div>
        <div className="confirm-message" id={messageId}>{prompt.message}</div>
        <div className="confirm-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={cancel}
            autoFocus={prompt.destructive}
          >
            {prompt.cancel_label}
          </button>
          {prompt.alt_label && prompt.onAlt ? (
            <button
              type="button"
              className="btn"
              onClick={() => { resolveAlt(); }}
            >
              {prompt.alt_label}
            </button>
          ) : null}
          <button
            type="button"
            className={`btn ${prompt.destructive ? "danger" : "primary"}`}
            onClick={() => { resolve(); }}
            autoFocus={!prompt.destructive}
          >
            {prompt.confirm_label}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-viewport" role="region" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast toast-${t.kind}`}
          onClick={() => dismiss(t.id)}
          title="Dismiss"
        >
          <span className="toast-icon">
            {t.kind === "error" ? "✕" : t.kind === "warn" ? "⚠" : t.kind === "success" ? "✓" : "ⓘ"}
          </span>
          <span className="toast-body">
            <span className="toast-msg">{t.message}</span>
            {t.detail ? <span className="toast-detail">{t.detail}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}
