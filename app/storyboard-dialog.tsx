"use client";

// Video → Storyboard: drop a video, the browser splits it into shots
// (lib/digest.ts, ported from movie-digest), Claude watches the keyframes and
// writes the breakdown (lib/vision.ts), and the result is an editable card
// grid that applies to the timeline as a real project.

import { useCallback, useRef, useState } from "react";
import type { DigestMode, Project, Storyboard, StoryboardCard } from "@/lib/types";
import { MODE_LABELS, digestVideo, type DigestProgress } from "@/lib/digest";
import { DescribeError, describeShots, type DescribeProgress } from "@/lib/vision";
import { transcribeVideo, type TranscribeProgress } from "@/lib/transcribe";
import {
  applyDescriptions,
  mergeIntoPrevious,
  projectFromStoryboard,
  storyboardFromDigest,
} from "@/lib/storyboard";
import { useProviderKeys } from "@/lib/providers";
import { toast } from "@/lib/toast";

type Stage = "pick" | "digesting" | "board" | "watching" | "listening";

function timecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function StoryboardDialog({
  project,
  anthropicKey,
  onApply,
  onClose,
  onOpenKeys,
}: {
  project: Project;
  anthropicKey: string | null;
  onApply: (next: Project) => void;
  onClose: () => void;
  onOpenKeys: () => void;
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [mode, setMode] = useState<DigestMode>("standard");
  const [progress, setProgress] = useState<DigestProgress | null>(null);
  const [watchProgress, setWatchProgress] = useState<DescribeProgress | null>(null);
  const [listenProgress, setListenProgress] = useState<TranscribeProgress | null>(null);
  const [board, setBoard] = useState<Storyboard | null>(null);
  const [voFromTranscript, setVoFromTranscript] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<File | null>(null);

  const elevenLabsKey = useProviderKeys((s) => s.keys.elevenlabs?.trim() || null);

  const runDigest = useCallback(
    async (file: File) => {
      setError(null);
      setStage("digesting");
      fileRef.current = file;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const digest = await digestVideo({
          file,
          mode,
          onProgress: setProgress,
          signal: controller.signal,
        });
        if (digest.shots.length === 0) {
          throw new Error("No shots detected — try a less strict mode.");
        }
        setBoard(storyboardFromDigest(digest));
        setStage("board");
        toast.success("Shots detected", `${digest.shots.length} shots from ${file.name}`);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setStage("pick");
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
        setStage("pick");
      }
    },
    [mode],
  );

  const runWatch = useCallback(async () => {
    if (!board || !anthropicKey) return;
    setError(null);
    setStage("watching");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const shots = board.cards.map((c) => ({
        id: c.id,
        start_s: c.source_start_s,
        duration_s: c.duration_s,
        thumbnail: c.thumbnail,
        change_score: c.change_score,
        pointer: c.pointer,
      }));
      const descriptions = await describeShots({
        shots,
        apiKey: anthropicKey,
        brief: project.brief,
        aspect: project.aspect,
        onProgress: setWatchProgress,
        signal: controller.signal,
      });
      setBoard((b) => (b ? applyDescriptions(b, descriptions) : b));
      toast.success("Claude watched the video", `${descriptions.length} shots described`);
    } catch (e) {
      if (e instanceof DescribeError) {
        // Keep every shot described before the run died; only the message
        // becomes a warning.
        if (e.partial.length > 0) {
          setBoard((b) => (b ? applyDescriptions(b, e.partial) : b));
        }
        setError(e.message);
      } else if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStage("board");
      setWatchProgress(null);
    }
  }, [board, anthropicKey, project.brief, project.aspect]);

  const runListen = useCallback(async () => {
    const file = fileRef.current;
    if (!board || !file || !elevenLabsKey) return;
    setError(null);
    setStage("listening");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const segments = await transcribeVideo({
        file,
        apiKey: elevenLabsKey,
        onProgress: setListenProgress,
        signal: controller.signal,
      });
      setBoard((b) => (b ? { ...b, transcript: segments } : b));
      if (segments.length > 0) {
        setVoFromTranscript(true);
        toast.success("Narration transcribed", `${segments.length} VO segments from ${file.name}`);
      } else {
        toast.info("No narration detected", "The video has no audible speech to carry as VO.");
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStage("board");
      setListenProgress(null);
    }
  }, [board, elevenLabsKey]);

  const updateCard = useCallback((cardId: string, patch: Partial<StoryboardCard>) => {
    setBoard((b) =>
      b
        ? { ...b, cards: b.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) }
        : b,
    );
  }, []);

  const moveCard = useCallback((cardId: string, dir: -1 | 1) => {
    setBoard((b) => {
      if (!b) return b;
      const cards = [...b.cards];
      const i = cards.findIndex((c) => c.id === cardId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cards.length) return b;
      [cards[i], cards[j]] = [cards[j], cards[i]];
      return { ...b, cards };
    });
  }, []);

  const removeCard = useCallback((cardId: string) => {
    setBoard((b) =>
      b && b.cards.length > 1
        ? { ...b, cards: b.cards.filter((c) => c.id !== cardId) }
        : b,
    );
  }, []);

  const handleApply = useCallback(() => {
    if (!board) return;
    const withVO = voFromTranscript && (board.transcript?.length ?? 0) > 0;
    const next = projectFromStoryboard(board, project, { voFromTranscript: withVO });
    onApply(next);
    toast.success(
      "Storyboard applied",
      `${next.sections.length} sections · ${next.duration_s.toFixed(0)}s${next.vo_segments.length > 0 ? ` · ${next.vo_segments.length} VO` : ""}`,
    );
    onClose();
  }, [board, project, voFromTranscript, onApply, onClose]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|mkv|avi)$/i.test(file.name)) {
        setError("That doesn't look like a video file.");
        return;
      }
      void runDigest(file);
    },
    [runDigest],
  );

  const cancelWork = () => {
    abortRef.current?.abort();
  };

  const totalDuration = board?.cards.reduce((acc, c) => acc + c.duration_s, 0) ?? 0;

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        cancelWork();
        onClose();
      }}
    >
      <div className="modal storyboard-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">// VIDEO → STORYBOARD</div>
            <div className="modal-sub">
              Drop a video · shots are detected in your browser · Claude watches and writes the breakdown · edit by text or thumbnail
            </div>
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              cancelWork();
              onClose();
            }}
          >
            ✕ Close
          </button>
        </div>

        <div className="modal-body">
          {error ? <div className="storyboard-error">⚠ {error}</div> : null}

          {stage === "pick" ? (
            <div
              className={`storyboard-drop ${dragOver ? "dragover" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFiles(e.dataTransfer.files);
              }}
            >
              <div className="storyboard-drop-title">Drop a video here</div>
              <div className="storyboard-drop-sub">
                mp4 / mov / webm — it never leaves your browser; only keyframes go to Claude
              </div>
              <div className="storyboard-drop-row">
                <label className="storyboard-mode-label">
                  Shot detection
                  <select
                    className="storyboard-mode"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as DigestMode)}
                  >
                    {(Object.keys(MODE_LABELS) as DigestMode[]).map((m) => (
                      <option key={m} value={m}>
                        {MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "video/*";
                    input.onchange = () => handleFiles(input.files);
                    input.click();
                  }}
                >
                  ▤ Choose video
                </button>
              </div>
              {!anthropicKey ? (
                <div className="storyboard-key-note">
                  No Anthropic key yet — shot detection still works, but the AI watch step needs one.{" "}
                  <button type="button" className="storyboard-link" onClick={onOpenKeys}>
                    🔑 Add key
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {stage === "digesting" ? (
            <div className="storyboard-progress">
              <div className="storyboard-progress-msg">{progress?.message ?? "Working…"}</div>
              <div className="storyboard-progress-track">
                <div
                  className="storyboard-progress-fill"
                  style={{ width: `${progress?.pct ?? 0}%` }}
                />
              </div>
              <button type="button" className="btn ghost" onClick={cancelWork}>
                ✕ Cancel
              </button>
            </div>
          ) : null}

          {stage === "watching" ? (
            <div className="storyboard-progress">
              <div className="storyboard-progress-msg">
                👁 {watchProgress?.message ?? "Claude is watching…"}
              </div>
              <div className="storyboard-progress-track">
                <div
                  className="storyboard-progress-fill"
                  style={{
                    width: `${watchProgress ? Math.round((watchProgress.done / Math.max(1, watchProgress.total)) * 100) : 5}%`,
                  }}
                />
              </div>
              <button type="button" className="btn ghost" onClick={cancelWork}>
                ✕ Cancel
              </button>
            </div>
          ) : null}

          {stage === "listening" ? (
            <div className="storyboard-progress">
              <div className="storyboard-progress-msg">
                🎙 {listenProgress?.message ?? "Listening…"}
              </div>
              <div className="storyboard-progress-track">
                <div
                  className="storyboard-progress-fill"
                  style={{ width: `${listenProgress?.pct ?? 5}%` }}
                />
              </div>
              <button type="button" className="btn ghost" onClick={cancelWork}>
                ✕ Cancel
              </button>
            </div>
          ) : null}

          {stage === "board" && board ? (
            <div className="storyboard-board">
              <div className="storyboard-toolbar">
                <span className="storyboard-meta">
                  {board.source_name} · {board.cards.length} shots · {totalDuration.toFixed(1)}s
                </span>
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {anthropicKey ? (
                    <button type="button" className="btn" onClick={() => void runWatch()}>
                      👁 {board.cards.some((c) => c.described) ? "Re-watch" : "AI watch"} — describe shots
                    </button>
                  ) : (
                    <button type="button" className="btn" onClick={onOpenKeys}>
                      🔑 Add Anthropic key to enable AI watch
                    </button>
                  )}
                  {elevenLabsKey ? (
                    <button type="button" className="btn" onClick={() => void runListen()}>
                      🎙 {board.transcript ? "Re-listen" : "Listen"} — transcribe narration
                    </button>
                  ) : (
                    <button type="button" className="btn" onClick={onOpenKeys}>
                      🔑 Add ElevenLabs key to enable transcription
                    </button>
                  )}
                </span>
              </div>
              <div className="storyboard-grid">
                {board.cards.map((card, i) => (
                  <div key={card.id} className="storyboard-card">
                    <div className="storyboard-thumb-wrap">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={card.thumbnail} alt={card.title} className="storyboard-thumb" />
                      <span className="storyboard-timecode">
                        {Math.floor(card.source_start_s / 60)}:
                        {Math.floor(card.source_start_s % 60)
                          .toString()
                          .padStart(2, "0")}
                      </span>
                      {card.pointer ? (
                        <span
                          className="storyboard-pointer"
                          style={{
                            left: `${card.pointer.nx * 100}%`,
                            top: `${card.pointer.ny * 100}%`,
                          }}
                          title={`Change centered ${card.pointer.region}`}
                        />
                      ) : null}
                    </div>
                    <input
                      className="storyboard-title"
                      value={card.title}
                      onChange={(e) => updateCard(card.id, { title: e.target.value })}
                      placeholder={`Shot ${i + 1}`}
                      aria-label={`Shot ${i + 1} title`}
                    />
                    <textarea
                      className="storyboard-desc"
                      value={card.description}
                      onChange={(e) => updateCard(card.id, { description: e.target.value })}
                      placeholder={card.described ? "" : "What happens in this shot…"}
                      rows={2}
                      aria-label={`Shot ${i + 1} description`}
                    />
                    <textarea
                      className="storyboard-prompt"
                      value={card.image_prompt}
                      onChange={(e) => updateCard(card.id, { image_prompt: e.target.value })}
                      placeholder="Image prompt (for regeneration)"
                      rows={2}
                      aria-label={`Shot ${i + 1} image prompt`}
                    />
                    <input
                      className="storyboard-prompt"
                      value={card.motion_prompt}
                      onChange={(e) => updateCard(card.id, { motion_prompt: e.target.value })}
                      placeholder="Motion prompt"
                      aria-label={`Shot ${i + 1} motion prompt`}
                    />
                    <div className="storyboard-card-foot">
                      <label className="storyboard-dur">
                        <input
                          type="number"
                          min={1}
                          max={30}
                          step={1}
                          value={Math.round(card.duration_s)}
                          onChange={(e) =>
                            updateCard(card.id, {
                              duration_s: Math.max(1, Math.min(30, Number(e.target.value) || 1)),
                            })
                          }
                          aria-label={`Shot ${i + 1} duration in seconds`}
                        />
                        s
                      </label>
                      <span className="storyboard-card-actions">
                        <button
                          type="button"
                          className="storyboard-iconbtn"
                          disabled={i === 0}
                          onClick={() => moveCard(card.id, -1)}
                          title="Move earlier"
                          aria-label={`Move shot ${i + 1} earlier`}
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          className="storyboard-iconbtn"
                          disabled={i === board.cards.length - 1}
                          onClick={() => moveCard(card.id, 1)}
                          title="Move later"
                          aria-label={`Move shot ${i + 1} later`}
                        >
                          →
                        </button>
                        <button
                          type="button"
                          className="storyboard-iconbtn"
                          disabled={i === 0}
                          onClick={() => setBoard((b) => (b ? mergeIntoPrevious(b, card.id) : b))}
                          title="Merge into previous shot"
                          aria-label={`Merge shot ${i + 1} into previous`}
                        >
                          ⇤
                        </button>
                        <button
                          type="button"
                          className="storyboard-iconbtn danger"
                          disabled={board.cards.length <= 1}
                          onClick={() => removeCard(card.id)}
                          title="Delete shot"
                          aria-label={`Delete shot ${i + 1}`}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {board.transcript && board.transcript.length > 0 ? (
                <div className="storyboard-card" style={{ marginTop: 14 }}>
                  <div className="storyboard-meta">
                    // TRANSCRIPT · {board.transcript.length} segment
                    {board.transcript.length === 1 ? "" : "s"} · applies as VO
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      maxHeight: 180,
                      overflowY: "auto",
                    }}
                  >
                    {board.transcript.map((seg) => (
                      <div
                        key={seg.id}
                        style={{ display: "flex", gap: 10, fontSize: 11, lineHeight: 1.5 }}
                      >
                        <span
                          className="storyboard-timecode"
                          style={{ position: "static", alignSelf: "flex-start", whiteSpace: "nowrap" }}
                        >
                          {timecode(seg.start_s)}
                        </span>
                        <span style={{ color: "var(--color-fg-muted)" }}>{seg.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="modal-foot">
          <span className="render-status">
            {stage === "board" && board
              ? `Applying replaces the current timeline with ${board.cards.length} sections`
              : "Shot detection runs locally via ffmpeg.wasm"}
          </span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {stage === "board" && board && (board.transcript?.length ?? 0) > 0 ? (
              <label className="storyboard-mode-label" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={voFromTranscript}
                  onChange={(e) => setVoFromTranscript(e.target.checked)}
                />
                VO from transcript
              </label>
            ) : null}
            {stage === "board" && board ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setBoard(null);
                  fileRef.current = null;
                  setStage("pick");
                }}
              >
                ↺ Start over
              </button>
            ) : null}
            <button
              type="button"
              className="btn primary"
              disabled={stage !== "board" || !board}
              onClick={handleApply}
            >
              ⇥ Apply to timeline
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
