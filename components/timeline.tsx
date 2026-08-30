"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import type { GraphicOverlay, Transition, TransitionType } from "@/lib/types";
import { toast } from "@/lib/toast";
import { gradeDescriptor } from "@/lib/grade";
import { formatTimecode, formatTransition, pickFile } from "@/components/lib";
import { Field, Popover, Waveform } from "@/components/ui";
import { VOTrack } from "@/components/vo";

/* ───────────── TIMELINE ───────────── */

export function Timeline({
  isPlaying,
  playheadSeconds,
  previewSectionId,
  editingVOId,
  setEditingVOId,
  onOpenMusicPanel,
  onOpenGradePanel,
}: {
  isPlaying: boolean;
  playheadSeconds: number;
  previewSectionId: string | null;
  editingVOId: string | null;
  setEditingVOId: (id: string | null) => void;
  onOpenMusicPanel: () => void;
  onOpenGradePanel: () => void;
}) {
  const project = useStore((s) => s.project);
  const activeSectionId = useStore((s) => s.activeSectionId);
  const setActiveSection = useStore((s) => s.setActiveSection);
  const setActiveVersionStore = useStore((s) => s.setActiveVersion);
  const addClipSection = useStore((s) => s.addClipSection);
  const removeSection = useStore((s) => s.removeSection);
  const moveSection = useStore((s) => s.moveSection);
  const moveSectionTo = useStore((s) => s.moveSectionTo);
  const duplicateSection = useStore((s) => s.duplicateSection);
  const updateTransition = useStore((s) => s.updateTransition);
  const addVOSegment = useStore((s) => s.addVOSegment);
  const updateVOSegment = useStore((s) => s.updateVOSegment);
  const addGraphic = useStore((s) => s.addGraphic);
  const updateGraphic = useStore((s) => s.updateGraphic);
  const removeGraphic = useStore((s) => s.removeGraphic);
  const updateStill = useStore((s) => s.updateStill);
  const updateClipVersion = useStore((s) => s.updateClipVersion);
  const updateMusic = useStore((s) => s.updateMusic);

  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [timelineVersionMenuId, setTimelineVersionMenuId] = useState<string | null>(null);
  const [editingTransitionId, setEditingTransitionId] = useState<string | null>(null);
  const [editingGraphicId, setEditingGraphicId] = useState<string | null>(null);

  const [dragSectionId, setDragSectionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; side: "before" | "after" } | null>(null);
  const [resizingSection, setResizingSection] = useState<{
    id: string;
    startX: number;
    origDuration: number;
    pxPerSec: number;
  } | null>(null);

  useEffect(() => {
    if (!resizingSection) return;
    const local = resizingSection;
    function onMove(e: PointerEvent) {
      const dxPx = e.clientX - local.startX;
      const dxSec = dxPx / local.pxPerSec;
      let next = Math.round((local.origDuration + dxSec) * 2) / 2;
      next = Math.max(0.5, Math.min(60, next));
      useStore.getState().updateSection(local.id, { duration_s: next });
    }
    function onUp() { setResizingSection(null); }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizingSection]);

  const [dragGraphicState, setDragGraphicState] = useState<{
    id: string;
    rowLeft: number;
    rowWidth: number;
  } | null>(null);

  useEffect(() => {
    if (!dragGraphicState) return;
    const local = dragGraphicState;
    function onMove(e: PointerEvent) {
      const pct = Math.max(0, Math.min(1, (e.clientX - local.rowLeft) / local.rowWidth));
      const newStart = Math.max(0, pct * useStore.getState().project.duration_s - 0.25);
      useStore.getState().updateGraphic(local.id, { start_s: parseFloat(newStart.toFixed(2)) });
    }
    function onUp() { setDragGraphicState(null); }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragGraphicState]);

  const transitionsByTo = useMemo(() => {
    const m = new Map<string, Transition>();
    for (const t of project.transitions) m.set(t.to_section_id, t);
    return m;
  }, [project.transitions]);

  const clipsCount = project.sections.length;
  const tlGridCols = project.sections.length > 0
    ? project.sections.map((s) => `${Math.max(0.1, s.duration_s)}fr`).join(" ")
    : "1fr";
  const aspectClass = `aspect-${project.aspect.replace(":", "-")}`;

  const activeSectionStartS = useMemo(() => {
    const idx = project.sections.findIndex((s) => s.id === activeSectionId);
    if (idx < 0) return playheadSeconds;
    return project.sections.slice(0, idx).reduce((a, s) => a + s.duration_s, 0);
  }, [project.sections, activeSectionId, playheadSeconds]);

  return (
      <div className="timeline-wrap">
        <div className="tl-label">
          <span>// TIMELINE</span>
        </div>
        {isPlaying ? (
          <div
            className="timeline-playhead"
            style={{ left: `${Math.min(100, (playheadSeconds / Math.max(0.01, project.duration_s)) * 100)}%` }}
          />
        ) : null}

        <div
          className="ruler clickable"
          style={{ gridTemplateColumns: tlGridCols }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const at = pct * project.duration_s;
            let acc = 0;
            for (let i = 0; i < project.sections.length; i++) {
              acc += project.sections[i].duration_s;
              if (at <= acc) {
                setActiveSection(project.sections[i].id);
                break;
              }
            }
          }}
        >
          {Array.from({ length: clipsCount }, (_, i) => (
            <span key={i}>
              {formatTimecode(
                project.sections.slice(0, i).reduce((a, s) => a + s.duration_s, 0),
              )}
            </span>
          ))}
        </div>

        <div className="tl-row-label">
          // GRAPHICS
          <div className="tl-row-actions">
            <button
              type="button"
              className="tl-row-add-btn"
              onClick={() => addGraphic(activeSectionStartS)}
              title="Add a graphic overlay"
            >
              + GRAPHIC
            </button>
          </div>
        </div>
        <div className="graphics-overlay-row">
          {(project.graphics ?? []).length === 0 ? (
            <div className="graphics-empty">
              no graphics yet · graphics overlay on top of clips
            </div>
          ) : (
            (project.graphics ?? []).map((g) => {
              const total = Math.max(0.01, project.duration_s);
              const left = (g.start_s / total) * 100;
              const width = Math.min(100 - left, (g.duration_s / total) * 100);
              const isEditing = editingGraphicId === g.id;
              return (
                <div
                  key={g.id}
                  className={`graphic-block ${isEditing ? "active" : ""} ${dragGraphicState?.id === g.id ? "dragging" : ""}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragGraphicState) return;
                    setEditingGraphicId(isEditing ? null : g.id);
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    const row = e.currentTarget.closest(".graphics-overlay-row") as HTMLElement | null;
                    if (!row) return;
                    const rect = row.getBoundingClientRect();
                    setDragGraphicState({ id: g.id, rowLeft: rect.left, rowWidth: rect.width });
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  }}
                  title={`${g.text} · ${g.start_s.toFixed(1)}s for ${g.duration_s.toFixed(1)}s · drag to move`}
                >
                  <span className="graphic-block-text">{g.text || "graphic"}</span>
                  <span className="graphic-block-time">
                    {g.start_s.toFixed(1)}s · {g.duration_s.toFixed(1)}s
                  </span>
                </div>
              );
            })
          )}
        </div>

        {editingGraphicId ? (() => {
          const eg = (project.graphics ?? []).find((g) => g.id === editingGraphicId);
          if (!eg) return null;
          return (
            <div className="graphic-inline-editor">
              <GraphicOverlayEditor
                overlay={eg}
                projectDuration={project.duration_s}
                onChange={(patch) => updateGraphic(eg.id, patch)}
                onRemove={() => {
                  removeGraphic(eg.id);
                  setEditingGraphicId(null);
                }}
              />
            </div>
          );
        })() : null}

        <div className="tl-row-label">
          // VIDEO
          <div className="tl-row-actions">
            <button
              type="button"
              className="tl-row-add-btn"
              onClick={() => addClipSection(null)}
              title="Add a new scene"
            >
              + VIDEO
            </button>
          </div>
        </div>
        <div
          className="clips-row"
          style={{ gridTemplateColumns: tlGridCols }}
        >
          {project.sections.map((section) => {
            const isTitle = section.type === "title";
            const isActive = section.id === activeSectionId;
            const isPreviewing = section.id === previewSectionId;
            const versionIdx = section.versions.findIndex((v) => v.id === section.active_version_id);
            const empty = versionIdx < 0;
            const versionLabel = empty ? "— not yet" : `v${versionIdx + 1} ▾`;
            const trans = transitionsByTo.get(section.id);
            const activeVer = section.versions.find((v) => v.id === section.active_version_id);
            const titleText =
              isTitle && activeVer && activeVer.kind === "title" ? activeVer.text : "";
            const readyKind: "ready" | "still" | "draft" | "missing" | "title" = (() => {
              if (isTitle) return "title";
              if (activeVer && activeVer.kind === "clip" && activeVer.output_url) return "ready";
              const stillId = activeVer && activeVer.kind === "clip" ? activeVer.still_ref ?? section.active_still_id : section.active_still_id;
              const still = stillId ? section.stills.find((s) => s.id === stillId) : null;
              if (still?.output_url) return "still";
              return empty ? "missing" : "draft";
            })();
            const cellKind: "CLIP" | "TITLE" = isTitle ? "TITLE" : "CLIP";
            return (
              <div
                key={section.id}
                className={`clip${isTitle ? " title-clip" : ""}${isActive ? " active" : ""}${empty && !isTitle ? " empty" : ""}${isPreviewing ? " previewing" : ""}${
                  dragSectionId === section.id ? " dragging" : ""
                }${dropTarget?.id === section.id ? ` drop-${dropTarget.side}` : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/x-ai-cinema-section", section.id);
                  setDragSectionId(section.id);
                }}
                onDragEnd={() => {
                  setDragSectionId(null);
                  setDropTarget(null);
                }}
                onDragOver={(e) => {
                  if (!dragSectionId || dragSectionId === section.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  const midX = rect.left + rect.width / 2;
                  const side: "before" | "after" = e.clientX < midX ? "before" : "after";
                  if (dropTarget?.id !== section.id || dropTarget.side !== side) {
                    setDropTarget({ id: section.id, side });
                  }
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  if (dropTarget?.id === section.id) setDropTarget(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const draggedId = e.dataTransfer.getData("text/x-ai-cinema-section");
                  if (draggedId && draggedId !== section.id && dropTarget) {
                    moveSectionTo(draggedId, section.id, dropTarget.side);
                  }
                  setDragSectionId(null);
                  setDropTarget(null);
                }}
                onClick={() => setActiveSection(section.id)}
                style={
                  isPreviewing ? { animationDuration: `${section.duration_s}s` } : undefined
                }
              >
                {trans ? (
                  <span className="popover-anchor">
                    <button
                      type="button"
                      className="trans-marker"
                      data-type={
                        trans.type === "crossfade" || trans.type === "fade_black"
                          ? "fade"
                          : undefined
                      }
                      title={formatTransition(trans.type, trans.duration_s)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingTransitionId(
                          editingTransitionId === trans.id ? null : trans.id,
                        );
                      }}
                    >
                      ◇
                    </button>
                    <Popover
                      open={editingTransitionId === trans.id}
                      onClose={() => setEditingTransitionId(null)}
                      className="trans-popover"
                    >
                      <TransitionEditor
                        transition={trans}
                        onChange={(patch) => updateTransition(trans.id, patch)}
                      />
                    </Popover>
                  </span>
                ) : null}
                <div className="clip-num-row">
                  <div className="clip-num">
                    <span className={`clip-dot clip-dot-${readyKind}`} title={
                      readyKind === "ready" ? "Motion rendered" :
                      readyKind === "still" ? "Still ready, motion pending" :
                      readyKind === "draft" ? "Draft — nothing generated" :
                      "Missing"
                    } />
                    {section.index.toString().padStart(2, "0")} // {cellKind}
                  </div>
                  {section.type === "clip" ? (
                    <button
                      type="button"
                      className="clip-import"
                      title="Import an image (becomes the still) or a video (becomes the rendered clip)"
                      aria-label={`Import media into ${section.title}`}
                      onClick={async (e) => {
                        e.stopPropagation();
                        const file = await pickFile("image/*,video/*");
                        if (!file) return;
                        const url = URL.createObjectURL(file);
                        if (file.type.startsWith("video/")) {
                          const ver = section.versions.find((v) => v.id === section.active_version_id);
                          if (ver && ver.kind === "clip") {
                            updateClipVersion(section.id, ver.id, { output_url: url });
                            toast.success("Video imported", `${file.name} · clip ${section.index}`);
                          } else {
                            toast.error("Import failed", "Add a clip version first");
                          }
                        } else {
                          const still = section.stills.find((s) => s.id === section.active_still_id);
                          if (still) {
                            updateStill(section.id, still.id, { output_url: url });
                            toast.success("Image imported", `${file.name} · still ${section.index}`);
                          } else {
                            toast.error("Import failed", "Add a still first");
                          }
                        }
                      }}
                    >
                      ▤ IMPORT
                    </button>
                  ) : null}
                </div>
                {(() => {
                  if (isTitle) {
                    return (
                      <div className={`clip-thumb title-thumb ${aspectClass}`}>
                        <span className="title-thumb-text">{titleText || "—"}</span>
                      </div>
                    );
                  }
                  const v = section.versions.find((x) => x.id === section.active_version_id);
                  const stillRef = v && v.kind === "clip" ? v.still_ref ?? section.active_still_id : section.active_still_id;
                  const still = stillRef ? section.stills.find((s) => s.id === stillRef) : null;
                  const thumb = still?.output_url;
                  const isVideo = v && v.kind === "clip" && v.output_url && /^https?:\/\//.test(v.output_url);
                  if (thumb) {
                    return (
                      <div className={`clip-thumb ${aspectClass}`}>
                        <img src={thumb} alt={section.title} />
                        {isVideo ? <span className="clip-thumb-badge">▶</span> : null}
                      </div>
                    );
                  }
                  return (
                    <div className={`clip-thumb empty ${aspectClass}`}>
                      no still
                    </div>
                  );
                })()}
                <div className="clip-title">
                  {section.title}
                  {section.notes && section.notes.trim().length > 0 ? (
                    <span className="clip-note-mark" title={section.notes}>💬</span>
                  ) : null}
                </div>
                <div className="clip-meta">
                  {empty ? (
                    <span className="clip-version">{versionLabel}</span>
                  ) : (
                    <span className="popover-anchor">
                      <button
                        type="button"
                        className="clip-version"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTimelineVersionMenuId(
                            timelineVersionMenuId === section.id ? null : section.id,
                          );
                        }}
                      >
                        {versionLabel}
                      </button>
                      <Popover
                        open={timelineVersionMenuId === section.id}
                        onClose={() => setTimelineVersionMenuId(null)}
                        className="menu wide"
                      >
                        {section.versions.map((v, vi) => (
                          <button
                            key={v.id}
                            type="button"
                            className={`menu-item ${v.id === section.active_version_id ? "active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveVersionStore(section.id, v.id);
                              setTimelineVersionMenuId(null);
                            }}
                          >
                            <span className="mi-tag">v{vi + 1}</span> {v.label}
                          </button>
                        ))}
                      </Popover>
                    </span>
                  )}
                  <span className="clip-dur">{section.duration_s.toFixed(1)}s</span>
                </div>
                <button
                  type="button"
                  className="clip-resize-handle"
                  title="Drag to resize duration"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const clipsRow = (e.currentTarget.closest(".clips-row") as HTMLElement) ?? null;
                    const rowWidth = clipsRow?.getBoundingClientRect().width ?? 800;
                    const pxPerSec = rowWidth / Math.max(1, project.duration_s);
                    setResizingSection({
                      id: section.id,
                      startX: e.clientX,
                      origDuration: section.duration_s,
                      pxPerSec,
                    });
                  }}
                >
                  ⇔
                </button>
                <span className="popover-anchor clip-insert">
                  <button
                    type="button"
                    className="clip-insert-btn"
                    title="Insert section after"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInsertAfterId(insertAfterId === section.id ? null : section.id);
                    }}
                  >
                    +
                  </button>
                  <Popover
                    open={insertAfterId === section.id}
                    onClose={() => setInsertAfterId(null)}
                    className="menu"
                  >
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        addClipSection(section.id);
                        setInsertAfterId(null);
                      }}
                    >
                      Clip
                    </button>
                  </Popover>
                </span>
                <div className="clip-actions">
                  <button
                    type="button"
                    className="clip-act"
                    title="Move section left"
                    aria-label="Move section left"
                    disabled={section.index === 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveSection(section.id, -1);
                    }}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className="clip-act"
                    title="Move section right"
                    aria-label="Move section right"
                    disabled={section.index === project.sections.length}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveSection(section.id, 1);
                    }}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className="clip-act"
                    title="Duplicate section"
                    aria-label="Duplicate section"
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicateSection(section.id);
                    }}
                  >
                    ⎘
                  </button>
                  <button
                    type="button"
                    className="clip-act remove"
                    title="Remove section"
                    aria-label="Remove section"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSection(section.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="timeline-add-row">
          <span className="popover-anchor">
            <button
              type="button"
              className="timeline-add"
              onClick={() => addClipSection(null)}
            >
              + Add scene
            </button>
          </span>
        </div>

        <div className="tl-row-label">
          // VOICEOVER
          <div className="tl-row-actions">
            <button
              type="button"
              className="tl-row-add-btn"
              onClick={() => addVOSegment()}
              title="Add a voiceover segment"
            >
              + VOICEOVER
            </button>
          </div>
        </div>
        <div className="audio-row vo-row">
          <VOTrack
            segments={project.vo_segments}
            duration={project.duration_s}
            editingVOId={editingVOId}
            setEditingVOId={setEditingVOId}
            updateVOSegment={updateVOSegment}
          />
        </div>

        <div className="tl-row-label">
          // MUSIC
          <div className="tl-row-actions">
            <button
              type="button"
              className="tl-row-add-btn"
              onClick={() => onOpenMusicPanel()}
              title="Open music editor"
            >
              + MUSIC
            </button>
          </div>
        </div>
        <div className="audio-row">
          <div className={`music-bed ${project.music_track?.output_url ? "voiced" : ""}`}>
            <button
              type="button"
              className="music-bed-main"
              onClick={() => onOpenMusicPanel()}
            >
              <span>
                <strong>{project.music_track?.name ?? "—"}</strong> ·{" "}
                {project.music_track?.model ?? "—"} · v1 · {project.duration_s.toFixed(1)}s · auto-ducks under VO −6dB
              </span>
              <span>{project.music_track?.output_url ? "♪ ✓" : "♪"} ▾</span>
            </button>
            <button
              type="button"
              className="track-import"
              title="Import your own music file (mp3, wav, m4a)"
              aria-label="Import music file"
              onClick={async () => {
                const file = await pickFile("audio/*");
                if (!file) return;
                const url = URL.createObjectURL(file);
                updateMusic({ output_url: url, name: file.name.replace(/\.[^.]+$/, "") });
                toast.success("Music imported", file.name);
              }}
            >
              ▤ IMPORT
            </button>
            {project.music_track?.output_url ? (
              <>
                <Waveform
                  url={project.music_track.output_url}
                  samples={240}
                  height={26}
                  color="var(--color-blood)"
                  className="music-bed-wave"
                />
                <audio src={project.music_track.output_url} controls className="music-bed-audio" />
              </>
            ) : null}
          </div>
        </div>

        <div className="audio-row" style={{ marginTop: 12 }}>
          <div className="grade-strip">
            <button
              type="button"
              className="grade-strip-main"
              onClick={() => onOpenGradePanel()}
            >
              <span>
                Final pass · <strong>{project.grade?.name ?? "—"}</strong>
                {project.grade ? ` · ${gradeDescriptor(project.grade)}` : ""}
              </span>
            </button>
          </div>
        </div>
      </div>
  );
}

/* ───────────── TRANSITION + VO EDITORS ───────────── */

function TransitionEditor({
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

function GraphicOverlayEditor({
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
