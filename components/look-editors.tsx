"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import type { LibraryItem, LibraryKind } from "@/lib/library";
import { Field, Popover } from "@/components/ui";

/* ───────────── LOOK SLOTS ───────────── */

export function LookSlot({
  label,
  icon,
  value,
  open,
  onToggle,
  alignRight = false,
  children,
}: {
  label: string;
  icon?: string;
  value?: string;
  open: boolean;
  onToggle: () => void;
  alignRight?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="slot popover-anchor">
      <button type="button" className="slot-btn" onClick={onToggle}>
        <span className="label">
          {icon ? <span className="slot-icon" aria-hidden>{icon}</span> : null}
          {label}
        </span>
        <span className="value">
          {value ?? "—"} <span className="caret">▾</span>
        </span>
      </button>
      <Popover
        open={open}
        onClose={onToggle}
        className="look-popover"
        align={alignRight ? "right" : "left"}
      >
        {children}
      </Popover>
    </div>
  );
}

type LibraryEditorProps<TItem> = {
  library: LibraryItem<TItem>[];
  onLoadPreset: (item: TItem) => void;
  onSaveAs: (name: string) => void;
  onRemovePreset: (id: string) => void;
  onRenamePreset: (id: string, name: string) => void;
};

export function LibrarySection<T>({
  library,
  kind,
  activeName,
  onLoadPreset,
  onSaveAs,
  onRemovePreset,
  onRenamePreset,
}: {
  library: LibraryItem<T>[];
  kind: LibraryKind;
  activeName?: string;
  onLoadPreset: (item: T) => void;
  onSaveAs: (name: string) => void;
  onRemovePreset: (id: string) => void;
  onRenamePreset: (id: string, name: string) => void;
}) {
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (saveAsOpen) setDraft(activeName ? `${activeName} copy` : "New preset");
  }, [saveAsOpen, activeName]);

  return (
    <div className="library-section">
      <div className="library-head">
        <span className="library-label">// LIBRARY</span>
        {saveAsOpen ? (
          <span className="library-save">
            <input
              className="field-input"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) {
                  onSaveAs(draft.trim());
                  setSaveAsOpen(false);
                }
                if (e.key === "Escape") setSaveAsOpen(false);
              }}
              placeholder="Preset name"
            />
            <button
              type="button"
              className="btn provider-act"
              disabled={!draft.trim()}
              onClick={() => {
                onSaveAs(draft.trim());
                setSaveAsOpen(false);
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="btn ghost provider-act"
              onClick={() => setSaveAsOpen(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="btn ghost provider-act" onClick={() => setSaveAsOpen(true)}>
            + Save current
          </button>
        )}
      </div>
      <div className="library-chips">
        {library.map((entry) => {
          const isActive = entry.name === activeName;
          return (
            <span key={entry.id} className={`lib-chip ${isActive ? "active" : ""}`}>
              <button
                type="button"
                className="lib-chip-pick"
                onClick={() => onLoadPreset(entry.item)}
                title={entry.built_in ? "Built-in preset" : "Saved preset"}
              >
                {entry.built_in ? <span className="lib-bi">★</span> : null}
                {entry.name}
              </button>
              {!entry.built_in ? (
                <button
                  type="button"
                  className="lib-chip-remove"
                  title="Remove from library"
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextName = prompt("Rename or empty to remove:", entry.name);
                    if (nextName === null) return;
                    const trimmed = nextName.trim();
                    if (!trimmed) onRemovePreset(entry.id);
                    else onRenamePreset(entry.id, trimmed);
                  }}
                >
                  ⋯
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function BriefEditor({
  brief,
  library,
  onChange,
  onLoadPreset,
  onSaveAs,
  onRemovePreset,
  onRenamePreset,
  onClose,
}: {
  brief: Project["brief"];
  onChange: (patch: Partial<NonNullable<Project["brief"]>>) => void;
  onClose: () => void;
} & LibraryEditorProps<NonNullable<Project["brief"]>>) {
  return (
    <div className="editor">
      <div className="editor-head">
        <span>// BRIEF</span>
        <button type="button" className="btn ghost" onClick={onClose} aria-label="Close brief editor" title="Close">✕</button>
      </div>
      <LibrarySection
        library={library}
        kind="brief"
        activeName={brief?.name}
        onLoadPreset={onLoadPreset}
        onSaveAs={onSaveAs}
        onRemovePreset={onRemovePreset}
        onRenamePreset={onRenamePreset}
      />
      <Field label="Name">
        <input
          className="field-input"
          value={brief?.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Brief name"
        />
      </Field>
      <Field label="Visual">
        <textarea
          rows={3}
          className="field-input tall"
          value={brief?.visual ?? ""}
          onChange={(e) => onChange({ visual: e.target.value })}
          placeholder="warm 35mm hero, photoreal, golden hour..."
        />
      </Field>
      <div className="field-row">
        <Field label="Lighting">
          <input
            className="field-input"
            value={brief?.lighting ?? ""}
            onChange={(e) => onChange({ lighting: e.target.value })}
            placeholder="soft side light"
          />
        </Field>
        <Field label="Camera">
          <input
            className="field-input"
            value={brief?.camera ?? ""}
            onChange={(e) => onChange({ camera: e.target.value })}
            placeholder="35mm, shallow focus"
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Palette">
          <input
            className="field-input"
            value={brief?.palette ?? ""}
            onChange={(e) => onChange({ palette: e.target.value })}
            placeholder="warm, golden"
          />
        </Field>
        <Field label="Subject">
          <input
            className="field-input"
            value={brief?.subject ?? ""}
            onChange={(e) => onChange({ subject: e.target.value })}
            placeholder="hero product"
          />
        </Field>
      </div>
      <Field label="Avoid">
        <input
          className="field-input"
          value={brief?.avoid ?? ""}
          onChange={(e) => onChange({ avoid: e.target.value })}
          placeholder="no logos, no text"
        />
      </Field>
      <Field label="Reference images">
        <RefList
          refs={brief?.refs ?? []}
          onChange={(refs) => onChange({ refs })}
        />
      </Field>
    </div>
  );
}

export function RefList({
  refs,
  onChange,
}: {
  refs: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="ref-list">
      {refs.length > 0 ? (
        <div className="ref-thumbs">
          {refs.map((url, i) => (
            <div key={`${url}|${i}`} className="ref-thumb">
              <img src={url} alt={`ref ${i + 1}`} />
              <button
                type="button"
                className="ref-remove"
                title="Remove"
                aria-label={`Remove reference ${i + 1}`}
                onClick={() => onChange(refs.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="ref-add">
        <input
          className="field-input"
          placeholder="https://..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              onChange([...refs, draft.trim()]);
              setDraft("");
            }
          }}
        />
        <button
          type="button"
          className="btn ghost"
          disabled={!draft.trim()}
          onClick={() => {
            if (!draft.trim()) return;
            onChange([...refs, draft.trim()]);
            setDraft("");
          }}
        >
          + Add
        </button>
      </div>
    </div>
  );
}

export function GradeEditor({
  grade,
  library,
  onChange,
  onLoadPreset,
  onSaveAs,
  onRemovePreset,
  onRenamePreset,
  onClose,
}: {
  grade: Project["grade"];
  onChange: (patch: Partial<NonNullable<Project["grade"]>>) => void;
  onClose: () => void;
} & LibraryEditorProps<NonNullable<Project["grade"]>>) {
  const adj = grade?.adjustments ?? {};
  const setAdjustment = (key: string, value: number | string) =>
    onChange({ adjustments: { ...adj, [key]: value } });
  const exposureValue = typeof adj.exposure === "number" ? adj.exposure : 0;
  const contrastValue = typeof adj.contrast === "number" ? adj.contrast : 0;
  return (
    <div className="editor">
      <div className="editor-head">
        <span>// GRADE</span>
        <button type="button" className="btn ghost" onClick={onClose} aria-label="Close grade editor" title="Close">✕</button>
      </div>
      <LibrarySection
        library={library}
        kind="grade"
        activeName={grade?.name}
        onLoadPreset={onLoadPreset}
        onSaveAs={onSaveAs}
        onRemovePreset={onRemovePreset}
        onRenamePreset={onRenamePreset}
      />
      <Field label="Name">
        <input
          className="field-input"
          value={grade?.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Warm Cinematic"
        />
      </Field>
      <div className="field-row">
        <Field label={`Exposure ${exposureValue > 0 ? "+" : ""}${exposureValue.toFixed(2)}`}>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={exposureValue}
            onChange={(e) => setAdjustment("exposure", Number(e.target.value))}
          />
        </Field>
        <Field label={`Contrast ${contrastValue > 0 ? "+" : ""}${contrastValue.toFixed(0)}`}>
          <input
            type="range"
            min={-50}
            max={50}
            step={1}
            value={contrastValue}
            onChange={(e) => setAdjustment("contrast", Number(e.target.value))}
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Mids">
          <select
            className="field-input"
            value={typeof adj.mids === "string" ? adj.mids : "neutral"}
            onChange={(e) => setAdjustment("mids", e.target.value)}
          >
            <option value="neutral">neutral</option>
            <option value="warm">warm</option>
            <option value="cool">cool</option>
          </select>
        </Field>
        <Field label="Blacks">
          <select
            className="field-input"
            value={typeof adj.blacks === "string" ? adj.blacks : "neutral"}
            onChange={(e) => setAdjustment("blacks", e.target.value)}
          >
            <option value="neutral">neutral</option>
            <option value="crushed">crushed</option>
            <option value="lifted">lifted</option>
          </select>
        </Field>
        <Field label="Shadow tint">
          <select
            className="field-input"
            value={typeof adj.shadow_tint === "string" ? adj.shadow_tint : "neutral"}
            onChange={(e) => setAdjustment("shadow_tint", e.target.value)}
          >
            <option value="neutral">neutral</option>
            <option value="teal">teal</option>
            <option value="warm">warm</option>
            <option value="violet">violet</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

export function MusicEditor({
  music,
  library,
  job,
  hasKey,
  durationS,
  onChange,
  onLoadPreset,
  onSaveAs,
  onRemovePreset,
  onRenamePreset,
  onGenerate,
  onDismissError,
  onClose,
}: {
  music: Project["music_track"];
  job?: { status: "running" | "error"; error?: string };
  hasKey: boolean;
  durationS: number;
  onChange: (patch: Partial<NonNullable<Project["music_track"]>>) => void;
  onGenerate: () => void;
  onDismissError: () => void;
  onClose: () => void;
} & LibraryEditorProps<NonNullable<Project["music_track"]>>) {
  return (
    <div className="editor">
      <div className="editor-head">
        <span>// MUSIC</span>
        <button type="button" className="btn ghost" onClick={onClose} aria-label="Close music editor" title="Close">✕</button>
      </div>
      <LibrarySection
        library={library}
        kind="music"
        activeName={music?.name}
        onLoadPreset={onLoadPreset}
        onSaveAs={onSaveAs}
        onRemovePreset={onRemovePreset}
        onRenamePreset={onRenamePreset}
      />
      <Field label="Name">
        <input
          className="field-input"
          value={music?.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Cinematic Build"
        />
      </Field>
      <Field label="Model">
        <select
          className="field-input"
          value={music?.model ?? "elevenlabs-music"}
          onChange={(e) => onChange({ model: e.target.value })}
        >
          <option value="elevenlabs-music">ElevenLabs Music</option>
          <option value="stable-audio">Stable Audio</option>
          <option value="suno">Suno</option>
        </select>
      </Field>
      <Field label="Prompt">
        <textarea
          rows={3}
          className="field-input tall"
          value={music?.prompt ?? ""}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="slow cinematic build, low piano, distant strings, no drums"
        />
      </Field>
      {music?.output_url ? (
        <Field label="Preview">
          <audio src={music.output_url} controls className="vo-audio" />
        </Field>
      ) : null}
      {job?.status === "error" ? (
        <div className="vo-error">
          <span>Error: {job.error}</span>
          <button type="button" className="btn ghost vo-error-dismiss" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="gen-row">
        <span className={`gen-cost ${!hasKey ? "warn" : ""}`}>
          {!hasKey
            ? "⊘ ElevenLabs key required"
            : `ElevenLabs Music · ${durationS.toFixed(0)}s · auto-fits project`}
        </span>
        <button
          type="button"
          className="btn primary"
          disabled={job?.status === "running"}
          onClick={onGenerate}
        >
          {job?.status === "running" ? "● Generating…" : "⏵ Generate music"}
        </button>
      </div>
    </div>
  );
}

export const GOOGLE_FONTS: { label: string; value: string; gfParam?: string }[] = [
  { label: "JetBrains Mono Bold", value: "JetBrains Mono Bold" },
  { label: "Inter Black", value: "Inter Black" },
  { label: "Playfair Display Black", value: "Playfair Display Black", gfParam: "Playfair+Display:wght@900" },
  { label: "Bebas Neue", value: "Bebas Neue", gfParam: "Bebas+Neue" },
  { label: "Anton", value: "Anton", gfParam: "Anton" },
  { label: "Oswald Bold", value: "Oswald Bold", gfParam: "Oswald:wght@700" },
  { label: "Montserrat Black", value: "Montserrat Black", gfParam: "Montserrat:wght@900" },
  { label: "DM Serif Display", value: "DM Serif Display", gfParam: "DM+Serif+Display" },
  { label: "Cinzel Bold", value: "Cinzel Bold", gfParam: "Cinzel:wght@700" },
  { label: "Raleway Black", value: "Raleway Black", gfParam: "Raleway:wght@900" },
  { label: "Libre Baskerville Bold", value: "Libre Baskerville Bold", gfParam: "Libre+Baskerville:ital,wght@0,700" },
  { label: "Cormorant Bold Italic", value: "Cormorant Bold Italic", gfParam: "Cormorant:ital,wght@1,700" },
  { label: "Permanent Marker", value: "Permanent Marker", gfParam: "Permanent+Marker" },
  { label: "Staatliches", value: "Staatliches", gfParam: "Staatliches" },
];

export function loadGoogleFont(param: string) {
  if (typeof document === "undefined") return;
  const url = `https://fonts.googleapis.com/css2?family=${param}&display=swap`;
  if (document.querySelector(`link[data-gf="${param}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.dataset.gf = param;
  document.head.appendChild(link);
}

export function TitleStyleEditor({
  style,
  library,
  onChange,
  onLoadPreset,
  onSaveAs,
  onRemovePreset,
  onRenamePreset,
  onClose,
}: {
  style: Project["title_settings"];
  onChange: (patch: Partial<NonNullable<Project["title_settings"]>>) => void;
  onClose: () => void;
} & LibraryEditorProps<NonNullable<Project["title_settings"]>>) {
  return (
    <div className="editor">
      <div className="editor-head">
        <span>// GRAPHIC STYLE</span>
        <button type="button" className="btn ghost" onClick={onClose} aria-label="Close title style editor" title="Close">✕</button>
      </div>
      <LibrarySection
        library={library}
        kind="title"
        activeName={style?.name}
        onLoadPreset={onLoadPreset}
        onSaveAs={onSaveAs}
        onRemovePreset={onRemovePreset}
        onRenamePreset={onRenamePreset}
      />
      <Field label="Name">
        <input
          className="field-input"
          value={style?.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="BFS Mono — Bone"
        />
      </Field>
      <Field label="Font">
        <select
          className="field-input"
          value={GOOGLE_FONTS.some((f) => f.value === (style?.font ?? "")) ? (style?.font ?? "") : ""}
          onChange={(e) => {
            const entry = GOOGLE_FONTS.find((f) => f.value === e.target.value);
            if (entry?.gfParam) loadGoogleFont(entry.gfParam);
            if (e.target.value) onChange({ font: e.target.value });
          }}
        >
          <option value="">— pick a font —</option>
          {GOOGLE_FONTS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <input
          className="field-input"
          style={{ marginTop: 4 }}
          value={style?.font ?? ""}
          onChange={(e) => onChange({ font: e.target.value })}
          placeholder="JetBrains Mono Bold"
        />
      </Field>
      <div className="field-row">
        <Field label="Color">
          <input
            type="color"
            className="field-input color-input"
            value={style?.color ?? "#f4f1ea"}
            onChange={(e) => onChange({ color: e.target.value })}
          />
        </Field>
        <Field label="Background">
          <input
            type="color"
            className="field-input color-input"
            value={style?.background_color ?? "#0a0908"}
            onChange={(e) => onChange({ background_color: e.target.value })}
          />
        </Field>
      </div>
      <div className="title-preview" style={{
        background: style?.background_color ?? "#0a0908",
        color: style?.color ?? "#f4f1ea",
        fontFamily: style?.font ?? "var(--font-mono)",
        fontWeight: "bold",
      }}>
        {style?.font ? style.font : "Title preview"}
      </div>
    </div>
  );
}
