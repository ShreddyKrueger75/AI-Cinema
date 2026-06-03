"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{
        background: "#0a0908",
        color: "#f4f1ea",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: "40px",
        margin: 0,
        minHeight: "100vh",
      }}>
        <div style={{
          maxWidth: 760,
          margin: "0 auto",
          border: "1px solid #ff4d7e",
          background: "rgba(255, 77, 126, 0.05)",
          padding: "28px",
        }}>
          <div style={{
            fontSize: 11,
            letterSpacing: "0.24em",
            textTransform: "uppercase",
            color: "#ff4d7e",
            marginBottom: 14,
          }}>// CLIENT ERROR</div>
          <div style={{ fontSize: 14, marginBottom: 10, color: "#fcbb00" }}>
            {error.name}: {error.message}
          </div>
          {error.digest ? (
            <div style={{ fontSize: 11, color: "#756f65", marginBottom: 18 }}>
              digest: {error.digest}
            </div>
          ) : null}
          {error.stack ? (
            <pre style={{
              fontSize: 11,
              color: "#b5afa5",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "#121110",
              padding: "16px",
              border: "1px solid #2a2724",
              margin: "0 0 18px",
              overflowX: "auto",
            }}>{error.stack}</pre>
          ) : null}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                background: "#ff4d7e",
                color: "#0a0908",
                border: "1px solid #ff4d7e",
                padding: "10px 18px",
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ↻ Retry
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  for (const k of Object.keys(localStorage)) {
                    if (k.startsWith("ai-cinema:")) localStorage.removeItem(k);
                  }
                  location.reload();
                } catch (e) {
                  console.error(e);
                }
              }}
              style={{
                background: "transparent",
                color: "#b5afa5",
                border: "1px solid #3a3631",
                padding: "10px 18px",
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ⌫ Clear storage + reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
