"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { voiceList } from "@/lib/elevenlabs";
import { measureAudioDuration, pickFile } from "@/components/lib";
import { Field, Waveform } from "@/components/ui";

/* ───────────── VO TRACK ───────────── */

type VOSeg = {
  id: string;
  text: string;
  voice: string;
  start_s: number;
  duration_s: number;
  output_url?: string;
};

export function VOTrack({
  segments,
  duration,
  editingVOId,
  setEditingVOId,
  updateVOSegment,
}: {
  segments: VOSeg[];
  duration: number;
  editingVOId: string | null;
  setEditingVOId: (id: string | null) => void;
  updateVOSegment: (id: string, patch: Partial<Omit<VOSeg, "id">>) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<
    | { id: string; mode: "move" | "resize-l" | "resize-r"; startX: number; orig: { start: number; dur: number } }
    | null
  >(null);

  useEffect(() => {
    if (!drag) return;
    const local = drag;
    function onMove(e: PointerEvent) {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dxPx = e.clientX - local.startX;
      const dxSec = (dxPx / rect.width) * duration;
      const snap = (v: number) => Math.round(v * 2) / 2;
      if (local.mode === "move") {
        let nextStart = snap(local.orig.start + dxSec);
        nextStart = Math.max(0, Math.min(duration - local.orig.dur, nextStart));
        updateVOSegment(local.id, { start_s: nextStart });
      } else if (local.mode === "resize-l") {
        let nextStart = snap(local.orig.start + dxSec);
        const minLen = 0.5;
        const maxStart = local.orig.start + local.orig.dur - minLen;
        nextStart = Math.max(0, Math.min(maxStart, nextStart));
        const nextDur = local.orig.start + local.orig.dur - nextStart;
        updateVOSegment(local.id, { start_s: nextStart, duration_s: nextDur });
      } else if (local.mode === "resize-r") {
        let nextDur = snap(local.orig.dur + dxSec);
        nextDur = Math.max(0.5, Math.min(duration - local.orig.start, nextDur));
        updateVOSegment(local.id, { duration_s: nextDur });
      }
    }
    function onUp() {
      setDrag(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, duration, updateVOSegment]);

  return (
    <div className="vo-track" ref={trackRef}>
      {Array.from({ length: Math.max(0, Math.ceil(duration / 3)) + 1 }, (_, i) => (
        <div
          key={i}
          className="vo-tick"
          style={{ left: `${Math.min(100, (i * 3 / duration) * 100)}%` }}
        />
      ))}
      {segments.map((seg, i) => {
        const left = (seg.start_s / duration) * 100;
        const width = (seg.duration_s / duration) * 100;
        const isDragging = drag?.id === seg.id;
        return (
          <div
            key={seg.id}
            className={`vo-seg ${seg.output_url ? "voiced" : ""}${isDragging ? " dragging" : ""}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <button
              type="button"
              className="vo-seg-resize left"
              title="Drag to change start"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                (e.target as Element).releasePointerCapture?.(e.pointerId);
                setDrag({
                  id: seg.id,
                  mode: "resize-l",
                  startX: e.clientX,
                  orig: { start: seg.start_s, dur: seg.duration_s },
                });
              }}
            >
              ◀
            </button>
            <div
              className="vo-seg-body"
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                e.preventDefault();
                setDrag({
                  id: seg.id,
                  mode: "move",
                  startX: e.clientX,
                  orig: { start: seg.start_s, dur: seg.duration_s },
                });
              }}
              onClick={(e) => {
                if (isDragging) return;
                if ((e.target as HTMLElement).closest("button")) return;
                setEditingVOId(editingVOId === seg.id ? null : seg.id);
              }}
              title={`${seg.start_s.toFixed(1)}s · ${seg.duration_s.toFixed(1)}s`}
            >
              <span className="vo-seg-head">
                v{i + 1} {seg.output_url ? "♪ " : ""}— <span className="vo-text">&ldquo;{seg.text}&rdquo;</span>
              </span>
              {seg.output_url ? (
                <Waveform
                  url={seg.output_url}
                  samples={64}
                  height={18}
                  color="var(--color-blood)"
                  className="vo-seg-wave"
                />
              ) : null}
            </div>
            <button
              type="button"
              className="vo-seg-resize right"
              title="Drag to change duration"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setDrag({
                  id: seg.id,
                  mode: "resize-r",
                  startX: e.clientX,
                  orig: { start: seg.start_s, dur: seg.duration_s },
                });
              }}
            >
              ▶
            </button>
          </div>
        );
      })}
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
              const url = URL.createObjectURL(file);
              const measured = await measureAudioDuration(url).catch(() => null);
              const patch: Partial<Omit<typeof segment, "id">> = { output_url: url };
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
          <audio src={segment.output_url} controls className="vo-audio" />
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
        <button
          type="button"
          className="btn primary"
          disabled={job?.status === "running"}
          onClick={onGenerate}
        >
          {job?.status === "running" ? "● Generating…" : "⏵ Generate VO"}
        </button>
      </div>
    </div>
  );
}
