"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import type { Project, VOSegment } from "@/lib/types";
import { toast } from "@/lib/toast";
import { gradeToCssFilter } from "@/lib/grade";
import { formatTimecode } from "@/components/lib";

export function PreviewAudio({
  isPlaying,
  playheadSeconds,
  musicUrl,
  voSegments,
}: {
  isPlaying: boolean;
  playheadSeconds: number;
  musicUrl: string | null;
  voSegments: VOSegment[];
}) {
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const voRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Music: start/stop with playback, seek to playhead on start.
  // Re-seeking on every tick would fight the audio's natural playback.
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

  // Auto-duck music under VO at -6dB (≈ 0.5x).
  useEffect(() => {
    const a = musicRef.current;
    if (!a) return;
    const ducking = voSegments.some(
      (seg) =>
        seg.output_url &&
        playheadSeconds >= seg.start_s &&
        playheadSeconds < seg.start_s + seg.duration_s,
    );
    a.volume = ducking ? 0.45 : 0.9;
  }, [playheadSeconds, voSegments]);

  return (
    <div style={{ display: "none" }} aria-hidden>
      {musicUrl ? (
        <audio ref={musicRef} src={musicUrl} preload="auto" />
      ) : null}
      {voSegments.map((seg) =>
        seg.output_url ? (
          <audio
            key={seg.id}
            ref={(el) => {
              if (el) voRefs.current.set(seg.id, el);
              else voRefs.current.delete(seg.id);
            }}
            src={seg.output_url}
            preload="auto"
          />
        ) : null,
      )}
    </div>
  );
}

/* ───────────── STAGE CONTROLS ───────────── */

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

/* ───────────── PREVIEW STAGE ───────────── */

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
    motionOutput && /^https?:\/\//.test(motionOutput) ? motionOutput : null;

  // Imperative video.play() / pause() — autoPlay doesn't re-trigger when the
  // attribute changes on an already-mounted element, and an effect run after a
  // click still counts as a user-gesture continuation for a muted source.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !motionVideoUrl) return;
    if (isPlaying) {
      try { v.currentTime = 0; } catch { /* ignore seek errors */ }
      v.play().catch((err: unknown) => {
        console.warn("[preview] video.play() rejected:", err);
      });
    } else {
      try { v.pause(); } catch { /* ignore */ }
    }
  }, [isPlaying, motionVideoUrl]);

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

  const aspectRatio =
    project.aspect === "16:9" ? "16 / 9" : project.aspect === "1:1" ? "1 / 1" : "9 / 16";

  const activeOverlays = (project.graphics ?? []).filter(
    (g) => startSeconds >= g.start_s && startSeconds < g.start_s + g.duration_s,
  );

  // Apply the grade only to the media surface, not the whole canvas, so HUD
  // chrome (timecode, badges, graphic overlays, play glyph) stays uncolored.
  const gradeFilter = project.grade ? gradeToCssFilter(project.grade) : undefined;

  return (
    <div className="preview-stage">
      <div className="stage-canvas-wrap">
        <div
          className={`stage-canvas aspect-${project.aspect.replace(":", "-")} ${isPlaying ? "playing" : "paused"}`}
          style={{ aspectRatio }}
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
          ) : motionVideoUrl ? (
            <video
              ref={videoRef}
              key={motionVideoUrl}
              src={motionVideoUrl}
              className="stage-video"
              muted
              loop
              playsInline
              style={gradeFilter ? { filter: gradeFilter } : undefined}
            />
          ) : stillUrl ? (
            <img
              key={`${stillUrl}|${kbDirection}|${section.duration_s}`}
              src={stillUrl}
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

          <div className="stage-hud">
            <span className="stage-idx">{section.index.toString().padStart(2, "0")}</span>
            <span className="stage-title-text">{section.title}</span>
            <span className="stage-type">{section.type === "title" ? "GRAPHIC" : "CLIP"}</span>
          </div>

          {activeOverlays.map((g) => (
            <div
              key={g.id}
              className={`stage-graphic-overlay pos-${g.position ?? "center"}`}
              style={{
                color: g.color ?? project.title_settings?.color ?? "#f4f1ea",
                fontFamily: g.font ?? project.title_settings?.font ?? "var(--font-display)",
              }}
            >
              <span>{g.text}</span>
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

function TitleCardLive({
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
