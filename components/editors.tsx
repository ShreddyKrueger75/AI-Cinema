"use client";

import { type ReactNode, useEffect, useState } from "react";
import type {
  Brief,
  Grade,
  GraphicOverlay,
  MusicSegment,
  MusicTrack,
  Project,
  TitleStyle,
  Transition,
  TransitionType,
} from "@/lib/types";
import { toast } from "@/lib/toast";
import { pickFile, measureAudioDuration, canBrowserPlayAudio } from "@/lib/media";
import { putAsset } from "@/lib/asset-store";
import { abortJob } from "@/lib/abort-jobs";
import { voiceList } from "@/lib/elevenlabs";
import type { LibraryItem, LibraryKind } from "@/lib/library";
import { Field, Popover, AssetAudio } from "@/components/primitives";

const GOOGLE_FONTS: { label: string; value: string; gfParam?: string }[] = [
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

export function TransitionEditor({
  transition,
  onChange,
}: {
  transition: Transition;
  onChange: (patch: { type?: TransitionType; duration_s?: number }) => void;
}) {
  const options: { id: TransitionType; label: string }[] = [
    { id: "cut", label: "Cut" },
    { id: "crossfade", label: "Crossfade" },
    { id: "fade_black", label: "Fade to black" },
  ];
  return (
    <div className="editor compact">
      <div className="editor-head">
        <span>// TRANSITION</span>
      </div>
      <div className="trans-options">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`trans-option ${transition.type === opt.id ? "active" : ""}`}
            onClick={() =>
              onChange({
                type: opt.id,
                duration_s: opt.id === "cut" ? 0 : Math.max(0.2, transition.duration_s || 0.4),
              })
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
      {transition.type !== "cut" ? (
        <Field label={`Duration ${transition.duration_s.toFixed(1)}s`}>
          <input
            type="range"
            min={0.2}
            max={1.6}
            step={0.1}
            value={transition.duration_s}
            onChange={(e) => onChange({ duration_s: Number(e.target.value) })}
          />
        </Field>
      ) : null}
    </div>
  );
}

export function GraphicOverlayEditor({
  overlay,
  projectDuration,
  onChange,
  onRemove,
}: {
  overlay: GraphicOverlay;
  projectDuration: number;
  onChange: (patch: Partial<Omit<GraphicOverlay, "id">>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="editor compact">
      <div className="editor-head">
        <span>// GRAPHIC</span>
        <button type="button" className="btn ghost" onClick={onRemove} aria-label="Remove graphic">✕ Remove</button>
      </div>
      <Field label="Text">
        <textarea
          rows={2}
          className="field-input tall"
          value={overlay.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="What the graphic says"
        />
      </Field>
      <div className="field-row">
        <Field label="Position">
          <select
            className="field-input"
            value={overlay.position ?? "center"}
            onChange={(e) => onChange({ position: e.target.value as "top" | "center" | "bottom" })}
          >
            <option value="top">Top</option>
            <option value="center">Center</option>
            <option value="bottom">Bottom</option>
          </select>
        </Field>
        <Field label={`Start ${overlay.start_s.toFixed(1)}s`}>
          <input
            type="range"
            min={0}
            max={Math.max(0, projectDuration - 0.5)}
            step={0.1}
            value={overlay.start_s}
            onChange={(e) => onChange({ start_s: parseFloat(e.target.value) })}
          />
        </Field>
        <Field label={`Duration ${overlay.duration_s.toFixed(1)}s`}>
          <input
            type="range"
            min={0.5}
            max={Math.max(0.5, projectDuration - overlay.start_s)}
            step={0.1}
            value={overlay.duration_s}
            onChange={(e) => onChange({ duration_s: parseFloat(e.target.value) })}
          />
        </Field>
      </div>
      <Field label="Color">
        <input
          type="color"
          className="field-input"
          value={overlay.color ?? "#f4f1ea"}
          onChange={(e) => onChange({ color: e.target.value })}
        />
      </Field>
    </div>
  );
}

export function VOSegmentEditor({
  segment,
  projectDuration,
  job,
  hasKey,
  onChange,
  onGenerate,
  onDismissError,
  onRemove,
}: {
  segment: {
    id: string;
    text: string;
    voice: string;
    start_s: number;
    duration_s: number;
    output_url?: string;
  };
  projectDuration: number;
  job?: { status: "running" | "error"; error?: string };
  hasKey: boolean;
  onChange: (patch: Partial<{ text: string; voice: string; start_s: number; duration_s: number; output_url: string }>) => void;
  onGenerate: () => void;
  onDismissError: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="editor compact">
      <div className="editor-head">
        <span>// VOICEOVER</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="btn ghost"
            title="Import an audio file instead of generating"
            onClick={async () => {
              const file = await pickFile("audio/*");
              if (!file) return;
              const check = canBrowserPlayAudio(file);
              if (!check.ok) {
                toast.error("Unsupported audio format", check.reason);
                return;
              }
              const persistedUrl = await putAsset(file);
              const measured = await measureAudioDuration(persistedUrl).catch(() => null);
              const patch: Partial<Omit<typeof segment, "id">> = { output_url: persistedUrl };
              if (measured && Number.isFinite(measured) && measured > 0) {
                patch.duration_s = measured;
              }
              onChange(patch);
              toast.success("VO imported", file.name);
            }}
          >
            ▤ Import
          </button>
          <button type="button" className="btn ghost" onClick={onRemove}>✕ Remove</button>
        </div>
      </div>
      <Field label="Text">
        <textarea
          rows={2}
          className="field-input tall"
          value={segment.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="What the voice says"
        />
      </Field>
      <div className="field-row">
        <Field label="Voice">
          <select
            className="field-input"
            value={segment.voice}
            onChange={(e) => onChange({ voice: e.target.value })}
          >
            {voiceList().map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </Field>
        <Field label={`Start ${segment.start_s.toFixed(1)}s`}>
          <input
            type="range"
            min={0}
            max={Math.max(0, projectDuration - 0.5)}
            step={0.5}
            value={segment.start_s}
            onChange={(e) => onChange({ start_s: Number(e.target.value) })}
          />
        </Field>
        <Field label={`Duration ${segment.duration_s.toFixed(1)}s`}>
          <input
            type="range"
            min={0.5}
            max={Math.max(0.5, projectDuration - segment.start_s)}
            step={0.5}
            value={segment.duration_s}
            onChange={(e) => onChange({ duration_s: Number(e.target.value) })}
          />
        </Field>
      </div>
      {segment.output_url ? (
        <Field label="Preview">
          <AssetAudio src={segment.output_url} controls className="vo-audio" />
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
          {!hasKey ? "⊘ ElevenLabs key required" : "ElevenLabs · ~$0.001 per char"}
        </span>
        {job?.status === "running" ? (
          <button
            type="button"
            className="btn ghost danger"
            onClick={() => abortJob(`vo:${segment.id}`)}
          >
            ✕ Cancel
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={onGenerate}>
            ⏵ Generate VO
          </button>
        )}
      </div>
    </div>
  );
}

export function MusicSegmentEditor({
  segment,
  projectDuration,
  job,
  hasKey,
  onChange,
  onGenerate,
  onDismissError,
  onRemove,
}: {
  segment: MusicSegment;
  projectDuration: number;
  job?: { status: "running" | "error"; error?: string };
  hasKey: boolean;
  onChange: (patch: Partial<Omit<MusicSegment, "id">>) => void;
  onGenerate: () => void;
  onDismissError: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="editor compact">
      <div className="editor-head">
        <span>// MUSIC</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="btn ghost"
            title="Import an audio file"
            onClick={async () => {
              const file = await pickFile("audio/*");
              if (!file) return;
              const check = canBrowserPlayAudio(file);
              if (!check.ok) {
                toast.error("Unsupported audio format", check.reason);
                return;
              }
              const persistedUrl = await putAsset(file);
              const measured = await measureAudioDuration(persistedUrl).catch(() => null);
              const patch: Partial<Omit<MusicSegment, "id">> = {
                output_url: persistedUrl,
                name: file.name.replace(/\.[^.]+$/, ""),
              };
              if (measured && Number.isFinite(measured) && measured > 0) {
                patch.duration_s = measured;
              }
              onChange(patch);
              toast.success("Music imported", file.name);
            }}
          >
            ▤ Import
          </button>
          <button type="button" className="btn ghost" onClick={onRemove}>✕ Remove</button>
        </div>
      </div>
      <Field label="Name">
        <input
          className="field-input"
          value={segment.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Track name"
        />
      </Field>
      <Field label="Prompt">
        <textarea
          rows={3}
          className="field-input tall"
          value={segment.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="cinematic build, low piano, distant strings"
        />
      </Field>
      <div className="field-row">
        <Field label="Model">
          <select
            className="field-input"
            value={segment.model}
            onChange={(e) => onChange({ model: e.target.value })}
          >
            <option value="elevenlabs-music">ElevenLabs Music</option>
            <option value="stable-audio">Stable Audio</option>
            <option value="suno">Suno</option>
          </select>
        </Field>
        <Field label={`Start ${segment.start_s.toFixed(1)}s`}>
          <input
            type="range"
            min={0}
            max={Math.max(0, projectDuration - 0.5)}
            step={0.5}
            value={segment.start_s}
            onChange={(e) => onChange({ start_s: Number(e.target.value) })}
          />
        </Field>
        <Field label={`Duration ${segment.duration_s.toFixed(1)}s`}>
          <input
            type="range"
            min={0.5}
            max={Math.max(0.5, projectDuration - segment.start_s)}
            step={0.5}
            value={segment.duration_s}
            onChange={(e) => onChange({ duration_s: Number(e.target.value) })}
          />
        </Field>
      </div>
      {segment.output_url ? (
        <Field label="Preview">
          <AssetAudio src={segment.output_url} controls className="vo-audio" />
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
          {!hasKey ? "⊘ ElevenLabs or Replicate key required" : `${segment.model} · ${segment.duration_s.toFixed(0)}s`}
        </span>
        {job?.status === "running" ? (
          <button
            type="button"
            className="btn ghost danger"
            onClick={() => abortJob(`music:${segment.id}`)}
          >
            ✕ Cancel
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={onGenerate}>
            ⏵ Generate music
          </button>
        )}
      </div>
    </div>
  );
}

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

export type LibraryEditorProps<TItem> = {
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
          <AssetAudio src={music.output_url} controls className="vo-audio" />
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
