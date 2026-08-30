"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useWaveform } from "@/lib/waveform";

/* ───────────── PRIMITIVES ───────────── */

function useClickOutside<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return ref;
}

export function Popover({
  open,
  onClose,
  children,
  className = "",
  style,
  align = "left",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  align?: "left" | "right" | "center";
}) {
  const ref = useClickOutside<HTMLDivElement>(onClose);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={`popover align-${align} ${className}`}
      style={style}
      role="dialog"
    >
      {children}
    </div>
  );
}

type InlineTextProps = {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  ariaLabel?: string;
  emptyLabel?: string;
};

export function InlineText({
  value,
  onCommit,
  placeholder,
  className = "",
  multiline = false,
  ariaLabel,
  emptyLabel,
}: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          autoFocus
          className={`inline-edit ${className}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
          rows={3}
          aria-label={ariaLabel}
        />
      );
    }
    return (
      <input
        autoFocus
        type="text"
        className={`inline-edit ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    );
  }

  const isEmpty = value.trim() === "";
  return (
    <span
      className={`inline-edit-display ${isEmpty ? "empty" : ""} ${className}`}
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      aria-label={ariaLabel}
      title="Click to edit"
    >
      {isEmpty ? emptyLabel ?? placeholder ?? "—" : value}
    </span>
  );
}

export function Waveform({
  url,
  samples = 120,
  height = 32,
  color = "var(--color-blood)",
  className,
}: {
  url: string | undefined | null;
  samples?: number;
  height?: number;
  color?: string;
  className?: string;
}) {
  const { data, error } = useWaveform(url, samples);
  if (!url) return null;
  return (
    <svg
      className={`waveform ${className ?? ""}`}
      viewBox={`0 0 ${samples} ${height}`}
      preserveAspectRatio="none"
      style={{ height, width: "100%" }}
      aria-hidden
    >
      {error ? (
        <text x="4" y={height / 2} fill="var(--color-fg-faint)" fontSize="9">{error}</text>
      ) : data ? (
        data.map((v, i) => {
          const h = Math.max(1, v * (height - 2));
          return (
            <rect
              key={i}
              x={i + 0.25}
              y={(height - h) / 2}
              width={0.65}
              height={h}
              fill={color}
              opacity={0.85}
            />
          );
        })
      ) : (
        <g>
          {Array.from({ length: samples }, (_, i) => (
            <rect
              key={i}
              x={i + 0.25}
              y={height / 2 - 1}
              width={0.65}
              height={2}
              fill="var(--color-line-strong)"
            />
          ))}
        </g>
      )}
    </svg>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
    </div>
  );
}
