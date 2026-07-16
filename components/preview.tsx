"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import type { Grade, GraphicOverlay, MusicSegment, Project, Section, VOSegment } from "@/lib/types";
import { toast } from "@/lib/toast";
import { gradeToCssFilter } from "@/lib/grade";
import { useAssetUrl } from "@/lib/use-asset-url";
import { AssetImg, Waveform, formatTimecode } from "@/components/primitives";

type VOSeg = {
  id: string;
  text: string;
  voice: string;
  start_s: number;
  duration_s: number;
  output_url?: string;
};

export function PreviewAudio({
  isPlaying,
  playheadSeconds,
  musicUrl,
  musicSegments,
  voSegments,
}: {
  isPlaying: boolean;
  playheadSeconds: number;
  musicUrl: string | null;
  musicSegments: MusicSegment[];
  voSegments: VOSegment[];
}) {
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const musicSegRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const voRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Music (legacy single-track): start/stop with playback, seek to playhead
  // on start. Re-seeking on every tick would fight the audio's natural
  // playback.
  useEffect(() => {
    const a = musicRef.current;
    if (!a) return;
    if (isPlaying) {
      try { a.currentTime = playheadSeconds; } catch { /* ignore */ }
      a.play().catch((err: unknown) => {
        console.warn("[preview] music.play() rejected:", err);
      });
    } else {
      try { a.pause(); } catch { /* ignore */ }
    }
    // playheadSeconds intentionally excluded — only re-seek on play/stop or url change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, musicUrl]);

  // Music segments: same window-gating as VO. Each segment is positioned on
  // the timeline by start_s and plays for duration_s.
  useEffect(() => {
    if (!isPlaying) {
      musicSegRefs.current.forEach((a) => {
        try { a.pause(); } catch { /* ignore */ }
      });
      return;
    }
    for (const seg of musicSegments) {
      const a = musicSegRefs.current.get(seg.id);
      if (!a || !seg.output_url) continue;
      const segEnd = seg.start_s + seg.duration_s;
      const inRange = playheadSeconds >= seg.start_s && playheadSeconds < segEnd;
      if (inRange) {
        if (a.paused) {
          try { a.currentTime = Math.max(0, playheadSeconds - seg.start_s); } catch { /* ignore */ }
          a.play().catch((err: unknown) => {
            console.warn("[preview] musicSeg.play() rejected:", err);
          });
        }
      } else if (!a.paused) {
        try { a.pause(); } catch { /* ignore */ }
      }
    }
  }, [isPlaying, playheadSeconds, musicSegments]);

  // VO: gate each segment by whether the playhead is inside its window.
  useEffect(() => {
    if (!isPlaying) {
      voRefs.current.forEach((a) => {
        try { a.pause(); } catch { /* ignore */ }
      });
      return;
    }
    for (const seg of voSegments) {
      const a = voRefs.current.get(seg.id);
      if (!a || !seg.output_url) continue;
      const segEnd = seg.start_s + seg.duration_s;
      const inRange = playheadSeconds >= seg.start_s && playheadSeconds < segEnd;
      if (inRange) {
        if (a.paused) {
          try { a.currentTime = Math.max(0, playheadSeconds - seg.start_s); } catch { /* ignore */ }
          a.play().catch((err: unknown) => {
            console.warn("[preview] vo.play() rejected:", err);
          });
        }
      } else if (!a.paused) {
        try { a.pause(); } catch { /* ignore */ }
      }
    }
  }, [isPlaying, playheadSeconds, voSegments]);

  // Auto-duck music (both legacy track and segments) under VO at -6dB (≈ 0.5x).
  useEffect(() => {
    const ducking = voSegments.some(
      (seg) =>
        seg.output_url &&
        playheadSeconds >= seg.start_s &&
        playheadSeconds < seg.start_s + seg.duration_s,
    );
    const vol = ducking ? 0.45 : 0.9;
    if (musicRef.current) musicRef.current.volume = vol;
    musicSegRefs.current.forEach((a) => { a.volume = vol; });
  }, [playheadSeconds, voSegments]);

  const resolvedMusicUrl = useAssetUrl(musicUrl);

  return (
    <div style={{ display: "none" }} aria-hidden>
      {resolvedMusicUrl ? (
        <audio ref={musicRef} src={resolvedMusicUrl} preload="auto" />
      ) : null}
      {musicSegments.map((seg) =>
        seg.output_url ? (
          <RegisteredAudio
            key={seg.id}
            url={seg.output_url}
            onMount={(el) => musicSegRefs.current.set(seg.id, el)}
            onUnmount={() => musicSegRefs.current.delete(seg.id)}
          />
        ) : null,
      )}
      {voSegments.map((seg) =>
        seg.output_url ? (
          <RegisteredAudio
            key={seg.id}
            url={seg.output_url}
            onMount={(el) => voRefs.current.set(seg.id, el)}
            onUnmount={() => voRefs.current.delete(seg.id)}
          />
        ) : null,
      )}
    </div>
  );
}

export function RegisteredAudio({
  url,
  onMount,
  onUnmount,
}: {
  url: string;
  onMount: (el: HTMLAudioElement) => void;
  onUnmount: () => void;
}) {
  const resolved = useAssetUrl(url);
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) onMount(el);
    return () => onUnmount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);
  if (!resolved) return null;
  return <audio ref={ref} src={resolved} preload="auto" />;
}

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

export function MusicTrack({
  segments,
  duration,
  editingMusicId,
  setEditingMusicId,
  updateMusicSegment,
}: {
  segments: MusicSegment[];
  duration: number;
  editingMusicId: string | null;
  setEditingMusicId: (id: string | null) => void;
  updateMusicSegment: (id: string, patch: Partial<Omit<MusicSegment, "id">>) => void;
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
        updateMusicSegment(local.id, { start_s: nextStart });
      } else if (local.mode === "resize-l") {
        let nextStart = snap(local.orig.start + dxSec);
        const minLen = 0.5;
        const maxStart = local.orig.start + local.orig.dur - minLen;
        nextStart = Math.max(0, Math.min(maxStart, nextStart));
        const nextDur = local.orig.start + local.orig.dur - nextStart;
        updateMusicSegment(local.id, { start_s: nextStart, duration_s: nextDur });
      } else if (local.mode === "resize-r") {
        let nextDur = snap(local.orig.dur + dxSec);
        nextDur = Math.max(0.5, Math.min(duration - local.orig.start, nextDur));
        updateMusicSegment(local.id, { duration_s: nextDur });
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
  }, [drag, duration, updateMusicSegment]);

  return (
    <div className="vo-track music-track" ref={trackRef}>
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
            className={`vo-seg music-seg ${seg.output_url ? "voiced" : ""}${isDragging ? " dragging" : ""}`}
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
                setEditingMusicId(editingMusicId === seg.id ? null : seg.id);
              }}
              title={`${seg.start_s.toFixed(1)}s · ${seg.duration_s.toFixed(1)}s`}
            >
              <span className="vo-seg-head">
                m{i + 1} {seg.output_url ? "♪ " : ""}— <span className="vo-text">{seg.name || seg.prompt}</span>
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

export function StageControls({
  project,
  currentIndex,
  startSeconds,
  isPlaying,
  onTogglePlay,
  onStop,
}: {
  project: Project;
  currentIndex: number;
  startSeconds: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
}) {
  const setActiveSection = useStore((s) => s.setActiveSection);
  const total = project.duration_s;

  const handleSeek = (idx: number) => {
    if (!project.sections.length) return;
    const next = ((idx % project.sections.length) + project.sections.length) % project.sections.length;
    setActiveSection(project.sections[next].id);
  };

  return (
    <div className="stage-controls" onClick={(e) => e.stopPropagation()}>
      <div className="stage-scrubber" role="presentation">
        {project.sections.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`stage-scrub-seg ${i === currentIndex ? "active" : ""} ${i < currentIndex ? "past" : ""}`}
            style={{ flex: Math.max(0.1, s.duration_s) }}
            onClick={() => setActiveSection(s.id)}
            title={`${s.index.toString().padStart(2, "0")} ${s.title} · ${formatTimecode(project.sections.slice(0, i).reduce((a, x) => a + x.duration_s, 0))}`}
            aria-label={`Jump to section ${s.index} ${s.title}`}
          />
        ))}
      </div>
      <div className="stage-controls-row">
        {project.sections[currentIndex] ? (
          <div className="stage-section-pill">
            <span className="stage-section-idx">{project.sections[currentIndex].index.toString().padStart(2, "0")}</span>
            <span className="stage-section-title">{project.sections[currentIndex].title}</span>
            <span className="stage-section-type">{project.sections[currentIndex].type === "title" ? "GRAPHIC" : "CLIP"}</span>
          </div>
        ) : null}
        <button type="button" className="stage-iconbtn" title="Previous" aria-label="Previous section" onClick={() => handleSeek(currentIndex - 1)}>⏮</button>
        <button
          type="button"
          className="stage-iconbtn primary"
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          aria-label={isPlaying ? "Pause preview" : "Play preview"}
          onClick={onTogglePlay}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <button type="button" className="stage-iconbtn" title="Next" aria-label="Next section" onClick={() => handleSeek(currentIndex + 1)}>⏭</button>
        {isPlaying ? (
          <button type="button" className="stage-iconbtn" title="Stop" aria-label="Stop preview" onClick={onStop}>◼</button>
        ) : null}
        <span className="stage-controls-time">
          {formatTimecode(startSeconds)}
          <span className="stage-divider"> / </span>
          {formatTimecode(total)}
        </span>
        <div className="stage-controls-spacer" />
        <button
          type="button"
          className="stage-iconbtn"
          title="Fullscreen"
          aria-label="Toggle fullscreen"
          onClick={() => {
            const canvas = document.querySelector(".stage-canvas") as HTMLElement | null;
            if (!canvas) return;
            if (document.fullscreenElement) {
              document.exitFullscreen().catch((err: unknown) => toast.warn("Couldn't exit fullscreen", String(err)));
              return;
            }
            canvas.requestFullscreen?.().catch((err: unknown) => toast.warn("Fullscreen blocked", String(err)));
          }}
        >
          ⛶
        </button>
      </div>
    </div>
  );
}

export function PreviewStage({
  project,
  currentIndex,
  startSeconds,
  isPlaying,
  onTogglePlay,
}: {
  project: Project;
  currentIndex: number;
  startSeconds: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const section = project.sections[currentIndex];

  const activeVersion =
    section?.versions.find((v) => v.id === section.active_version_id) ?? null;
  const motionOutput =
    activeVersion && activeVersion.kind === "clip" ? activeVersion.output_url : undefined;
  const motionVideoUrl =
    motionOutput && /^(https?:|blob:|data:video|assetdb:)/.test(motionOutput) ? motionOutput : null;
  const resolvedMotionUrl = useAssetUrl(motionVideoUrl);

  // Imperative video.play() / pause() — autoPlay doesn't re-trigger when the
  // attribute changes on an already-mounted element, and an effect run after a
  // click still counts as a user-gesture continuation for a muted source.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !resolvedMotionUrl) return;
    if (isPlaying) {
      try { v.currentTime = 0; } catch { /* ignore seek errors */ }
      v.play().catch((err: unknown) => {
        console.warn("[preview] video.play() rejected:", err);
      });
    } else {
      try { v.pause(); } catch { /* ignore */ }
    }
  }, [isPlaying, resolvedMotionUrl]);

  if (!section) {
    return (
      <div className="preview-stage empty">
        <div className="stage-empty">No sections yet — add a clip or title to begin.</div>
      </div>
    );
  }

  const activeStill = section.stills.find((s) => s.id === section.active_still_id) ?? null;
  const referencedStill =
    activeVersion && activeVersion.kind === "clip" && activeVersion.still_ref
      ? section.stills.find((s) => s.id === activeVersion.still_ref) ?? activeStill
      : activeStill;

  const kbDirection =
    motionOutput && motionOutput.startsWith("kenburns:")
      ? (motionOutput.slice("kenburns:".length) as "in" | "out" | "left" | "right")
      : null;
  const stillUrl = referencedStill?.output_url ?? null;
  const resolvedStillUrl = useAssetUrl(stillUrl);

  const aspectRatio =
    project.aspect === "16:9" ? "16 / 9" : project.aspect === "1:1" ? "1 / 1" : "9 / 16";

  const activeOverlays = (project.graphics ?? []).filter(
    (g) => startSeconds >= g.start_s && startSeconds < g.start_s + g.duration_s,
  );

  // Apply the grade only to the media surface, not the whole canvas, so HUD
  // chrome (timecode, badges, graphic overlays, play glyph) stays uncolored.
  const gradeFilter = project.grade ? gradeToCssFilter(project.grade) : undefined;

  // Incoming transition for the current section — animates when we enter
  // this clip during playback (crossfade fades in, fade_black flashes black).
  const incomingTransition = project.transitions.find((t) => t.to_section_id === section.id);
  const transitionClass = isPlaying && incomingTransition && incomingTransition.type !== "cut"
    ? `enter-${incomingTransition.type}`
    : "";
  const transitionDuration = incomingTransition ? incomingTransition.duration_s : 0;

  return (
    <div className="preview-stage">
      <div className="stage-canvas-wrap">
        <div
          key={`${section.id}-${isPlaying ? "play" : "pause"}`}
          className={`stage-canvas aspect-${project.aspect.replace(":", "-")} ${isPlaying ? "playing" : "paused"} ${transitionClass}`}
          style={{ aspectRatio, ['--transition-duration' as string]: `${transitionDuration}s` }}
        >
          {section.type === "title" ? (
            <TitleCardLive
              text={
                activeVersion && activeVersion.kind === "title" ? activeVersion.text : ""
              }
              style={project.title_settings}
              isPlaying={isPlaying}
              duration={section.duration_s}
            />
          ) : resolvedMotionUrl ? (
            <video
              ref={videoRef}
              key={resolvedMotionUrl}
              src={resolvedMotionUrl}
              className="stage-video"
              muted
              loop
              playsInline
              style={gradeFilter ? { filter: gradeFilter } : undefined}
            />
          ) : resolvedStillUrl ? (
            <img
              key={`${resolvedStillUrl}|${kbDirection}|${section.duration_s}`}
              src={resolvedStillUrl}
              alt={section.title}
              className={`stage-img${kbDirection ? ` kb kb-${kbDirection}` : ""}`}
              style={{
                ...(kbDirection
                  ? { animationDuration: `${activeVersion && activeVersion.kind === "clip" ? activeVersion.motion.duration_s : section.duration_s}s` }
                  : null),
                ...(gradeFilter ? { filter: gradeFilter } : null),
              }}
            />
          ) : (
            <div className="stage-empty">
              <span>no still generated</span>
              <span className="stage-empty-hint">click a section in the timeline · open its flow panel to generate</span>
            </div>
          )}

          {activeOverlays.map((g) => (
            <div
              key={g.id}
              className={`stage-graphic-overlay pos-${g.position ?? "center"}`}
              style={{
                color: g.color ?? project.title_settings?.color ?? "#f4f1ea",
                fontFamily: g.font ?? project.title_settings?.font ?? "var(--font-display)",
              }}
            >
              {g.image_url ? (
                <AssetImg src={g.image_url} alt={g.text || g.label} className="stage-graphic-img" />
              ) : (
                <span>{g.text}</span>
              )}
            </div>
          ))}

          {/* Center play overlay when paused */}
          {!isPlaying ? (
            <button
              type="button"
              className="stage-center-play"
              onClick={onTogglePlay}
              aria-label="Play preview"
              title="Play preview (Space)"
            >
              <span className="stage-center-play-glyph">▶</span>
            </button>
          ) : null}
        </div>
      </div>

    </div>
  );
}

export function TitleCardLive({
  text,
  style,
  isPlaying,
  duration,
}: {
  text: string;
  style: Project["title_settings"];
  isPlaying: boolean;
  duration: number;
}) {
  return (
    <div
      className="stage-title-card"
      style={{
        background: style?.background_color ?? "#0a0908",
        color: style?.color ?? "#f4f1ea",
        fontFamily: style?.font ?? "var(--font-display)",
        animationDuration: isPlaying ? `${duration}s` : undefined,
      }}
    >
      <span>{text}</span>
    </div>
  );
}
