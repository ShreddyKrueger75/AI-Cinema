"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { selectActiveSection, useStore } from "@/lib/store";
import type {
  Aspect,
  Grade,
  Project,
  Section,
  Transition,
  TransitionType,
  Version,
} from "@/lib/types";
import { downloadProjectJSON, pickProjectJSONFile } from "@/lib/serialize";
import {
  DURATION_OPTIONS_S,
  IMAGE_MODELS,
  MOTION_MODELS,
  imageModelCost,
  isImageModelFree,
  isMotionModelFree,
  motionModelCost,
} from "@/lib/models";
import { kenBurnsFromPrompt, newSeed, pollinationsUrl } from "@/lib/generate";
import {
  PROVIDERS,
  maskKey,
  providerForModel,
  useProviderKeys,
  type ProviderId,
} from "@/lib/providers";
import { useLibrary, type LibraryItem, type LibraryKind } from "@/lib/library";
import { TEMPLATES } from "@/lib/templates";

const ASPECT_OPTIONS: Aspect[] = ["9:16", "16:9", "1:1"];

const SECTION_DURATION_OPTIONS_S = [1, 2, 3, 4, 5, 6, 8, 10];

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTransition(type: string, duration: number): string {
  if (type === "cut") return "Cut";
  if (type === "fade_black") return "Fade to black";
  return `Crossfade ${duration.toFixed(1)}s`;
}

function formatCost(c: number): string {
  return c >= 1 ? `~ $${c.toFixed(2)}` : `~ $${c.toFixed(3)}`;
}

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

function Popover({
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

function InlineText({
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

/* ───────────── PAGE ───────────── */

export default function HomePage() {
  const project = useStore((s) => s.project);
  const activeSectionId = useStore((s) => s.activeSectionId);
  const activeSection = useStore(selectActiveSection);
  const setActiveSection = useStore((s) => s.setActiveSection);
  const setProject = useStore((s) => s.setProject);
  const updateProjectMeta = useStore((s) => s.updateProjectMeta);
  const addClipSection = useStore((s) => s.addClipSection);
  const addTitleSection = useStore((s) => s.addTitleSection);
  const removeSection = useStore((s) => s.removeSection);
  const moveSection = useStore((s) => s.moveSection);
  const duplicateSection = useStore((s) => s.duplicateSection);
  const resetProject = useStore((s) => s.resetProject);
  const updateTransition = useStore((s) => s.updateTransition);
  const addVOSegment = useStore((s) => s.addVOSegment);
  const updateVOSegment = useStore((s) => s.updateVOSegment);
  const removeVOSegment = useStore((s) => s.removeVOSegment);
  const updateBrief = useStore((s) => s.updateBrief);
  const updateGrade = useStore((s) => s.updateGrade);
  const updateMusic = useStore((s) => s.updateMusic);
  const updateTitleStyle = useStore((s) => s.updateTitleStyle);

  const providerKeys = useProviderKeys((s) => s.keys);
  const setProviderKey = useProviderKeys((s) => s.setKey);
  const removeProviderKey = useProviderKeys((s) => s.removeKey);

  const libraryBriefs = useLibrary((s) => s.briefs);
  const libraryGrades = useLibrary((s) => s.grades);
  const libraryMusic = useLibrary((s) => s.music);
  const libraryTitles = useLibrary((s) => s.titles);
  const saveBriefToLibrary = useLibrary((s) => s.saveBrief);
  const saveGradeToLibrary = useLibrary((s) => s.saveGrade);
  const saveMusicToLibrary = useLibrary((s) => s.saveMusic);
  const saveTitleToLibrary = useLibrary((s) => s.saveTitle);
  const removeLibraryItem = useLibrary((s) => s.removeItem);
  const renameLibraryItem = useLibrary((s) => s.renameItem);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    Promise.all([
      Promise.resolve(useStore.persist.rehydrate()),
      Promise.resolve(useProviderKeys.persist.rehydrate()),
      Promise.resolve(useLibrary.persist.rehydrate()),
    ]).finally(() => setHydrated(true));
  }, []);

  const configuredKeyCount = Object.values(providerKeys).filter((v) => v && v.trim()).length;

  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [editingTransitionId, setEditingTransitionId] = useState<string | null>(null);
  const [editingVOId, setEditingVOId] = useState<string | null>(null);
  const [lookOpen, setLookOpen] = useState<null | "brief" | "grade" | "music" | "title">(null);
  const [renderOpen, setRenderOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [playPosition, setPlayPosition] = useState<number | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPreview = useCallback(() => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    playTimerRef.current = null;
    setPlayPosition(null);
  }, []);

  useEffect(() => () => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
  }, []);

  const startPreview = useCallback(() => {
    if (project.sections.length === 0) return;
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    setPlayPosition(0);
    const advance = (i: number) => {
      const section = project.sections[i];
      if (!section) {
        setPlayPosition(null);
        playTimerRef.current = null;
        return;
      }
      const ms = Math.max(300, section.duration_s * 1000);
      playTimerRef.current = setTimeout(() => {
        const next = i + 1;
        if (next >= project.sections.length) {
          setPlayPosition(null);
          playTimerRef.current = null;
        } else {
          setPlayPosition(next);
          advance(next);
        }
      }, ms);
    };
    advance(0);
  }, [project.sections]);

  const togglePreview = playPosition !== null ? stopPreview : startPreview;
  const previewSectionId =
    playPosition !== null ? project.sections[playPosition]?.id ?? null : null;

  const handleReset = useCallback(() => {
    if (confirm("Reset project to defaults? Unsaved work will be lost.")) resetProject();
  }, [resetProject]);
  const handleExportLUT = useCallback(() => {
    if (!project.grade) return;
    downloadCubeLUT(project.grade);
  }, [project.grade]);

  const transitionsByTo = useMemo(() => {
    const m = new Map<string, Transition>();
    for (const t of project.transitions) m.set(t.to_section_id, t);
    return m;
  }, [project.transitions]);

  const clipsCount = project.sections.length;
  const totalCols = Math.max(1, clipsCount);

  const handleExport = () => downloadProjectJSON(project);
  const handleImport = async () => {
    const result = await pickProjectJSONFile();
    if (result.ok) setProject(result.project);
    else alert(result.error);
  };

  return (
    <>
      <div className="statusbar">
        <div className="left">
          <span><span className="dot" />SYSTEM // ONLINE</span>
          <span>BUILD 0.0.1</span>
          <button
            type="button"
            className="status-link"
            onClick={() => setProvidersOpen(true)}
            title="Manage provider API keys"
          >
            <span className={`dot ${configuredKeyCount === 0 ? "warn" : ""}`} />
            {configuredKeyCount === 0
              ? "FREE PREVIEW · NO KEY NEEDED"
              : `PROVIDERS // ${configuredKeyCount} KEY${configuredKeyCount === 1 ? "" : "S"}`}
          </button>
        </div>
        <div className="right">
          <span>{hydrated ? "STATE // PERSISTED" : "STATE // EPHEMERAL"}</span>
          <span>HELLO@JOHNLACROIX.COM</span>
        </div>
      </div>

      <div className="wordmark">
        <span className="painted">AI Cinema</span>
        <span className="lockup">by Bloody Finger</span>
      </div>
      <div className="tagline">Cinematic video, made easy. Bring your own model.</div>

      <div className="project-head">
        <div className="project-meta">
          <h1>
            <span className="slash">//</span>{" "}
            <InlineText
              value={project.name}
              onCommit={(name) => updateProjectMeta({ name })}
              ariaLabel="Project name"
              placeholder="Untitled project"
            />
          </h1>
          <div className="specs">
            <span>{project.duration_s.toFixed(1)}s</span>
            <span className="popover-anchor">
              <button
                type="button"
                className="spec-pick"
                onClick={() => setAspectMenuOpen((o) => !o)}
              >
                {project.aspect.replace(":", " : ")} <span className="caret">▾</span>
              </button>
              <Popover open={aspectMenuOpen} onClose={() => setAspectMenuOpen(false)} className="menu">
                {ASPECT_OPTIONS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`menu-item ${a === project.aspect ? "active" : ""}`}
                    onClick={() => {
                      updateProjectMeta({ aspect: a });
                      setAspectMenuOpen(false);
                    }}
                  >
                    {a.replace(":", " : ")}
                  </button>
                ))}
              </Popover>
            </span>
            <span>{clipsCount} clips</span>
            <span>v{project.revision} / {project.status}</span>
          </div>
        </div>
        <div className="project-actions">
          <span className="popover-anchor">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setTemplatesOpen((o) => !o)}
              title="Project templates"
            >
              ⚀ Templates
            </button>
            <Popover
              open={templatesOpen}
              onClose={() => setTemplatesOpen(false)}
              className="templates-menu"
            >
              <div className="templates-head">// PROJECT TEMPLATES</div>
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="template-item"
                  onClick={() => {
                    if (confirm(`Load "${t.name}"? Current project will be replaced.`)) {
                      setProject(t.build());
                    }
                    setTemplatesOpen(false);
                  }}
                >
                  <span className="tpl-name">{t.name}</span>
                  <span className="tpl-desc">{t.description}</span>
                </button>
              ))}
            </Popover>
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setProvidersOpen(true)}
            title="API keys"
          >
            🔑 Keys{configuredKeyCount > 0 ? ` (${configuredKeyCount})` : ""}
          </button>
          <button type="button" className="btn ghost" onClick={handleReset} title="Reset to defaults">↺ Reset</button>
          <button type="button" className="btn ghost" onClick={handleImport}>Import</button>
          <button type="button" className="btn ghost" onClick={handleExport}>Export</button>
          <button
            type="button"
            className={`btn ${playPosition !== null ? "primary" : ""}`}
            onClick={togglePreview}
            title="Walk through each section for its duration"
          >
            {playPosition !== null ? "■ Stop" : "▶ Preview"}
          </button>
          <button type="button" className="btn primary" onClick={() => setRenderOpen(true)}>▶︎ Render</button>
        </div>
      </div>

      <div className="lookbar">
        <LookSlot
          label="// BRIEF"
          value={project.brief?.name}
          open={lookOpen === "brief"}
          onToggle={() => setLookOpen(lookOpen === "brief" ? null : "brief")}
        >
          <BriefEditor
            brief={project.brief}
            library={libraryBriefs}
            onChange={updateBrief}
            onLoadPreset={(item) => {
              const { id: _drop, ...rest } = item;
              updateBrief(rest);
            }}
            onSaveAs={(name) => project.brief && saveBriefToLibrary(project.brief, name)}
            onRemovePreset={(id) => removeLibraryItem("brief", id)}
            onRenamePreset={(id, name) => renameLibraryItem("brief", id, name)}
            onClose={() => setLookOpen(null)}
          />
        </LookSlot>
        <LookSlot
          label="// GRADE"
          value={project.grade?.name}
          open={lookOpen === "grade"}
          onToggle={() => setLookOpen(lookOpen === "grade" ? null : "grade")}
        >
          <GradeEditor
            grade={project.grade}
            library={libraryGrades}
            onChange={updateGrade}
            onLoadPreset={(item) => {
              const { id: _drop, ...rest } = item;
              updateGrade(rest);
            }}
            onSaveAs={(name) => project.grade && saveGradeToLibrary(project.grade, name)}
            onRemovePreset={(id) => removeLibraryItem("grade", id)}
            onRenamePreset={(id, name) => renameLibraryItem("grade", id, name)}
            onClose={() => setLookOpen(null)}
          />
        </LookSlot>
        <LookSlot
          label="// MUSIC"
          value={project.music_track?.name}
          open={lookOpen === "music"}
          onToggle={() => setLookOpen(lookOpen === "music" ? null : "music")}
        >
          <MusicEditor
            music={project.music_track}
            library={libraryMusic}
            onChange={updateMusic}
            onLoadPreset={(item) => {
              const { id: _drop, ...rest } = item;
              updateMusic(rest);
            }}
            onSaveAs={(name) => project.music_track && saveMusicToLibrary(project.music_track, name)}
            onRemovePreset={(id) => removeLibraryItem("music", id)}
            onRenamePreset={(id, name) => renameLibraryItem("music", id, name)}
            onClose={() => setLookOpen(null)}
          />
        </LookSlot>
        <LookSlot
          label="// TITLE STYLE"
          value={project.title_settings?.name}
          open={lookOpen === "title"}
          onToggle={() => setLookOpen(lookOpen === "title" ? null : "title")}
          alignRight
        >
          <TitleStyleEditor
            style={project.title_settings}
            library={libraryTitles}
            onChange={updateTitleStyle}
            onLoadPreset={(item) => {
              const { id: _drop, ...rest } = item;
              updateTitleStyle(rest);
            }}
            onSaveAs={(name) =>
              project.title_settings && saveTitleToLibrary(project.title_settings, name)
            }
            onRemovePreset={(id) => removeLibraryItem("title", id)}
            onRenamePreset={(id, name) => renameLibraryItem("title", id, name)}
            onClose={() => setLookOpen(null)}
          />
        </LookSlot>
      </div>

      <div className="timeline-wrap">
        <div className="tl-label">
          <span>// TIMELINE</span>
          <span>Click a clip to open the flow · Click ◇ to set transitions</span>
        </div>

        <div
          className="ruler"
          style={{ gridTemplateColumns: `repeat(${totalCols}, 1fr)` }}
        >
          {Array.from({ length: clipsCount }, (_, i) => (
            <span key={i}>
              {formatTimecode(
                project.sections.slice(0, i).reduce((a, s) => a + s.duration_s, 0),
              )}
            </span>
          ))}
        </div>

        <div
          className="clips-row"
          style={{ gridTemplateColumns: `repeat(${totalCols}, 1fr)` }}
        >
          {project.sections.map((section) => {
            const isActive = section.id === activeSectionId;
            const isPreviewing = section.id === previewSectionId;
            const versionIdx = section.versions.findIndex((v) => v.id === section.active_version_id);
            const empty = versionIdx < 0;
            const versionLabel = empty ? "— not yet" : `v${versionIdx + 1} ▾`;
            const trans = transitionsByTo.get(section.id);
            return (
              <div
                key={section.id}
                className={`clip${isActive ? " active" : ""}${empty ? " empty" : ""}${isPreviewing ? " previewing" : ""}`}
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
                <div className="clip-num">
                  {section.index.toString().padStart(2, "0")} // {section.type.toUpperCase()}
                </div>
                <div className="clip-title">{section.title}</div>
                <div className="clip-meta">
                  <span className="clip-version">{versionLabel}</span>
                  <span className="clip-dur">{section.duration_s.toFixed(1)}s</span>
                </div>
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
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        addTitleSection(section.id);
                        setInsertAfterId(null);
                      }}
                    >
                      Title card
                    </button>
                  </Popover>
                </span>
                <div className="clip-actions">
                  <button
                    type="button"
                    className="clip-act"
                    title="Move left"
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
                    title="Move right"
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
              onClick={() => setAddMenuOpen((o) => !o)}
            >
              + Add section
            </button>
            <Popover open={addMenuOpen} onClose={() => setAddMenuOpen(false)} className="menu">
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  addClipSection(null);
                  setAddMenuOpen(false);
                }}
              >
                Clip
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  addTitleSection(null);
                  setAddMenuOpen(false);
                }}
              >
                Title card
              </button>
            </Popover>
          </span>
        </div>

        <div
          className="audio-row"
          style={{ marginTop: 14, gridTemplateColumns: `repeat(${totalCols}, 1fr)` }}
        >
          <div className="track-label">VO</div>
          {project.vo_segments.map((seg, i) => {
            const startCol =
              Math.floor((seg.start_s / project.duration_s) * totalCols) + 1;
            const endCol = Math.max(
              startCol + 1,
              startCol + Math.max(1, Math.round((seg.duration_s / project.duration_s) * totalCols)),
            );
            return (
              <span
                key={seg.id}
                className="popover-anchor"
                style={{ gridColumn: `${startCol} / ${Math.min(totalCols + 1, endCol)}` }}
              >
                <button
                  type="button"
                  className="vo-seg"
                  onClick={() =>
                    setEditingVOId(editingVOId === seg.id ? null : seg.id)
                  }
                >
                  v{i + 1} — <span className="vo-text">&ldquo;{seg.text}&rdquo;</span>
                </button>
                <Popover
                  open={editingVOId === seg.id}
                  onClose={() => setEditingVOId(null)}
                  className="vo-popover"
                >
                  <VOSegmentEditor
                    segment={seg}
                    projectDuration={project.duration_s}
                    onChange={(patch) => updateVOSegment(seg.id, patch)}
                    onRemove={() => {
                      removeVOSegment(seg.id);
                      setEditingVOId(null);
                    }}
                  />
                </Popover>
              </span>
            );
          })}
          <button
            type="button"
            className="vo-seg vo-add"
            style={{ gridColumn: `${totalCols} / ${totalCols + 1}` }}
            onClick={addVOSegment}
            title="Add VO segment"
          >
            + VO
          </button>
        </div>

        <div className="audio-row" style={{ marginTop: 8 }}>
          <div className="track-label">MUSIC</div>
          <button
            type="button"
            className="music-bed"
            onClick={() => setLookOpen("music")}
          >
            <span>
              <strong>{project.music_track?.name ?? "—"}</strong> ·{" "}
              {project.music_track?.model ?? "—"} · v1 · {project.duration_s.toFixed(1)}s · auto-ducks under VO −6dB
            </span>
            <span>♪ ▾</span>
          </button>
        </div>

        <div className="audio-row" style={{ marginTop: 12 }}>
          <div className="grade-strip">
            <button
              type="button"
              className="grade-strip-main"
              onClick={() => setLookOpen("grade")}
            >
              <span>
                Final pass · <strong>{project.grade?.name ?? "—"}</strong> · exposure +
                {String(project.grade?.adjustments.exposure ?? 0)} · contrast +
                {String(project.grade?.adjustments.contrast ?? 0)} · warm mids · crushed blacks · teal shadow
              </span>
            </button>
            <button
              type="button"
              className="grade-export"
              onClick={handleExportLUT}
              disabled={!project.grade}
              title="Export grade as .cube LUT"
            >
              ⤓ EXPORT LUT
            </button>
          </div>
        </div>
      </div>

      {activeSection ? (
        <FlowPanel
          section={activeSection}
          project={project}
          providerKeys={providerKeys}
          onOpenProviders={() => setProvidersOpen(true)}
        />
      ) : null}

      {renderOpen ? (
        <RenderDialog project={project} onClose={() => setRenderOpen(false)} />
      ) : null}

      {providersOpen ? (
        <ProvidersDialog
          keys={providerKeys}
          onSetKey={setProviderKey}
          onRemoveKey={removeProviderKey}
          onClose={() => setProvidersOpen(false)}
        />
      ) : null}

      <div className="footstrip">
        <span>// AI CINEMA · BUILT FOR THE LOVE OF THE GAME · MIT</span>
        <span>BLOODY FINGER SOFTWARE — 2026</span>
      </div>
    </>
  );
}

/* ───────────── LOOK SLOTS ───────────── */

function LookSlot({
  label,
  value,
  open,
  onToggle,
  alignRight = false,
  children,
}: {
  label: string;
  value?: string;
  open: boolean;
  onToggle: () => void;
  alignRight?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="slot popover-anchor">
      <button type="button" className="slot-btn" onClick={onToggle}>
        <span className="label">{label}</span>
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

function LibrarySection<T>({
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

function BriefEditor({
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
        <button type="button" className="btn ghost" onClick={onClose}>✕</button>
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

function RefList({
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

function GradeEditor({
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
        <button type="button" className="btn ghost" onClick={onClose}>✕</button>
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

function MusicEditor({
  music,
  library,
  onChange,
  onLoadPreset,
  onSaveAs,
  onRemovePreset,
  onRenamePreset,
  onClose,
}: {
  music: Project["music_track"];
  onChange: (patch: Partial<NonNullable<Project["music_track"]>>) => void;
  onClose: () => void;
} & LibraryEditorProps<NonNullable<Project["music_track"]>>) {
  return (
    <div className="editor">
      <div className="editor-head">
        <span>// MUSIC</span>
        <button type="button" className="btn ghost" onClick={onClose}>✕</button>
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
    </div>
  );
}

function TitleStyleEditor({
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
        <span>// TITLE STYLE</span>
        <button type="button" className="btn ghost" onClick={onClose}>✕</button>
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
        <input
          className="field-input"
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
      }}>
        Title preview
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
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

function VOSegmentEditor({
  segment,
  projectDuration,
  onChange,
  onRemove,
}: {
  segment: { id: string; text: string; voice: string; start_s: number; duration_s: number };
  projectDuration: number;
  onChange: (patch: Partial<{ text: string; voice: string; start_s: number; duration_s: number }>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="editor compact">
      <div className="editor-head">
        <span>// VO</span>
        <button type="button" className="btn ghost" onClick={onRemove}>✕ Remove</button>
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
            <option value="default">Default</option>
            <option value="warm">Warm</option>
            <option value="cool">Cool</option>
            <option value="gravel">Gravel</option>
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
    </div>
  );
}

/* ───────────── FLOW PANEL ───────────── */

function FlowPanel({
  section,
  project,
  providerKeys,
  onOpenProviders,
}: {
  section: Section;
  project: Project;
  providerKeys: Partial<Record<ProviderId, string>>;
  onOpenProviders: () => void;
}) {
  const setActiveSection = useStore((s) => s.setActiveSection);
  const setActiveVersion = useStore((s) => s.setActiveVersion);
  const setActiveStill = useStore((s) => s.setActiveStill);
  const updateStill = useStore((s) => s.updateStill);
  const addStill = useStore((s) => s.addStill);
  const removeStill = useStore((s) => s.removeStill);
  const updateClipVersion = useStore((s) => s.updateClipVersion);
  const addClipVersion = useStore((s) => s.addClipVersion);
  const removeClipVersion = useStore((s) => s.removeClipVersion);
  const updateTitleVersion = useStore((s) => s.updateTitleVersion);
  const addTitleVersion = useStore((s) => s.addTitleVersion);
  const removeTitleVersion = useStore((s) => s.removeTitleVersion);
  const updateSection = useStore((s) => s.updateSection);

  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);

  const startTime = useMemo(
    () =>
      project.sections.slice(0, section.index - 1).reduce((a, s) => a + s.duration_s, 0),
    [project.sections, section.index],
  );

  const activeVersion = section.versions.find((v) => v.id === section.active_version_id) ?? null;
  const activeStill = section.stills.find((s) => s.id === section.active_still_id) ?? null;

  const priorClipSections = project.sections.filter(
    (s) => s.type === "clip" && s.index < section.index,
  );

  const referencedStill =
    activeVersion && activeVersion.kind === "clip" && activeVersion.still_ref
      ? section.stills.find((s) => s.id === activeVersion.still_ref) ?? activeStill
      : activeStill;

  const modelHasKey = (modelId: string): boolean => {
    const pid = providerForModel(modelId);
    return pid ? !!providerKeys[pid] : false;
  };
  const promptForKey = (providerName: string) => {
    if (
      confirm(
        `${providerName} needs an API key. Open Providers to add one? (Or switch to a free model.)`,
      )
    ) {
      onOpenProviders();
    }
  };

  const handleGenerateStill = () => {
    if (!activeStill) return;
    if (!isImageModelFree(activeStill.model) && !modelHasKey(activeStill.model)) {
      const pid = providerForModel(activeStill.model);
      promptForKey(PROVIDERS.find((p) => p.id === pid)?.name ?? activeStill.model);
      return;
    }
    if (!isImageModelFree(activeStill.model)) {
      alert(
        `Live ${activeStill.model} generation ships next. For now, switch to "Pollinations (free)" to preview.`,
      );
      return;
    }
    const url = pollinationsUrl(
      activeStill.image_prompt,
      project.aspect,
      newSeed(),
      project.brief?.visual,
    );
    updateStill(section.id, activeStill.id, { output_url: url });
  };

  const handleGenerateMotion = () => {
    if (!activeVersion || activeVersion.kind !== "clip") return;
    if (!isMotionModelFree(activeVersion.motion.model) && !modelHasKey(activeVersion.motion.model)) {
      const pid = providerForModel(activeVersion.motion.model);
      promptForKey(PROVIDERS.find((p) => p.id === pid)?.name ?? activeVersion.motion.model);
      return;
    }
    if (!isMotionModelFree(activeVersion.motion.model)) {
      alert(
        `Live ${activeVersion.motion.model} generation ships next. For now, switch to "Ken Burns (free)" to preview.`,
      );
      return;
    }
    const stillToUse = referencedStill;
    if (stillToUse && !stillToUse.output_url && isImageModelFree(stillToUse.model)) {
      const url = pollinationsUrl(
        stillToUse.image_prompt,
        project.aspect,
        newSeed(),
        project.brief?.visual,
      );
      updateStill(section.id, stillToUse.id, { output_url: url });
    }
    const direction = kenBurnsFromPrompt(activeVersion.motion.prompt);
    updateClipVersion(section.id, activeVersion.id, {
      output_url: `kenburns:${direction}`,
      still_ref: activeVersion.still_ref ?? activeStill?.id ?? null,
    });
  };

  const motionDirection =
    activeVersion && activeVersion.kind === "clip" && activeVersion.output_url?.startsWith("kenburns:")
      ? (activeVersion.output_url.slice("kenburns:".length) as "in" | "out" | "left" | "right")
      : null;

  const motionStillUrl = motionDirection && referencedStill?.output_url ? referencedStill.output_url : null;

  const versionIdx = activeVersion ? section.versions.findIndex((v) => v.id === activeVersion.id) : -1;

  return (
    <div className="flow-panel">
      <div className="flow-head">
        <div className="title">
          <span className="slash">//</span>{" "}
          {section.index.toString().padStart(2, "0")} —{" "}
          <InlineText
            value={section.title}
            onCommit={(title) => updateSection(section.id, { title })}
            ariaLabel="Section title"
            placeholder="Section name"
          />
          <span className="timecode">
            {formatTimecode(startTime)} — {formatTimecode(startTime + section.duration_s)}
          </span>
          <span className="popover-anchor">
            <button
              type="button"
              className="spec-pick small"
              onClick={() => setDurationMenuOpen((o) => !o)}
              title="Section duration"
            >
              {section.duration_s.toFixed(1)}s <span className="caret">▾</span>
            </button>
            <Popover
              open={durationMenuOpen}
              onClose={() => setDurationMenuOpen(false)}
              className="menu"
            >
              {SECTION_DURATION_OPTIONS_S.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`menu-item ${d === section.duration_s ? "active" : ""}`}
                  onClick={() => {
                    updateSection(section.id, { duration_s: d });
                    setDurationMenuOpen(false);
                  }}
                >
                  {d.toFixed(1)}s
                </button>
              ))}
            </Popover>
          </span>
        </div>
        <div className="right">
          {activeVersion ? (
            <span className="popover-anchor">
              <button
                type="button"
                className="version-dd"
                onClick={() => setVersionMenuOpen((o) => !o)}
              >
                <span>v{versionIdx + 1}</span>
                <span>{activeVersion.label}</span>
                <span className="caret">▾</span>
              </button>
              <Popover
                open={versionMenuOpen}
                onClose={() => setVersionMenuOpen(false)}
                className="menu wide"
              >
                {section.versions.map((v, i) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`menu-item ${v.id === activeVersion.id ? "active" : ""}`}
                    onClick={() => {
                      setActiveVersion(section.id, v.id);
                      setVersionMenuOpen(false);
                    }}
                  >
                    <span className="mi-tag">v{i + 1}</span> {v.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="menu-item add"
                  onClick={() => {
                    if (section.type === "clip") addClipVersion(section.id);
                    else addTitleVersion(section.id);
                    setVersionMenuOpen(false);
                  }}
                >
                  + new version
                </button>
              </Popover>
            </span>
          ) : null}
          <button type="button" className="btn ghost" onClick={() => setActiveSection(null)}>
            ✕ Close
          </button>
        </div>
      </div>

      {section.type === "title" ? (
        <TitleFlowBody
          section={section}
          activeVersion={activeVersion}
          onChangeTitleVersion={(patch) =>
            activeVersion && updateTitleVersion(section.id, activeVersion.id, patch)
          }
          onSelectVersion={(id) => setActiveVersion(section.id, id)}
          onAddVersion={() => addTitleVersion(section.id)}
          onRemoveVersion={(id) => removeTitleVersion(section.id, id)}
          titleStyleName={project.title_settings?.name}
        />
      ) : (
        <ClipFlowBody
          section={section}
          project={project}
          activeStill={activeStill}
          activeVersion={activeVersion && activeVersion.kind === "clip" ? activeVersion : null}
          motionDirection={motionDirection}
          motionStillUrl={motionStillUrl}
          priorClipSections={priorClipSections}
          modelHasKey={modelHasKey}
          onUpdateStill={(stillId, patch) => updateStill(section.id, stillId, patch)}
          onAddStill={() => addStill(section.id)}
          onRemoveStill={(stillId) => removeStill(section.id, stillId)}
          onSelectStill={(stillId) => setActiveStill(section.id, stillId)}
          onUpdateClipVersion={(versionId, patch) =>
            updateClipVersion(section.id, versionId, patch)
          }
          onAddClipVersion={() => addClipVersion(section.id)}
          onRemoveClipVersion={(versionId) => removeClipVersion(section.id, versionId)}
          onSelectVersion={(versionId) => setActiveVersion(section.id, versionId)}
          onGenerateStill={handleGenerateStill}
          onGenerateMotion={handleGenerateMotion}
        />
      )}
    </div>
  );
}

/* ───────────── TITLE FLOW BODY ───────────── */

function TitleFlowBody({
  section,
  activeVersion,
  onChangeTitleVersion,
  onSelectVersion,
  onAddVersion,
  onRemoveVersion,
  titleStyleName,
}: {
  section: Section;
  activeVersion: Version | null;
  onChangeTitleVersion: (patch: { label?: string; text?: string }) => void;
  onSelectVersion: (id: string) => void;
  onAddVersion: () => void;
  onRemoveVersion: (id: string) => void;
  titleStyleName?: string;
}) {
  const titleVersion = activeVersion && activeVersion.kind === "title" ? activeVersion : null;
  return (
    <div className="flow-body single">
      <div className="stage full">
        <div className="stage-title"><span className="num">01</span>TITLE CARD</div>
        <Field label="Text">
          <textarea
            className="field-input tall"
            rows={3}
            value={titleVersion?.text ?? ""}
            disabled={!titleVersion}
            placeholder={titleVersion ? "Title text" : "+ new version to start"}
            onChange={(e) => onChangeTitleVersion({ text: e.target.value })}
          />
        </Field>
        <Field label="Version label">
          <input
            className="field-input"
            value={titleVersion?.label ?? ""}
            disabled={!titleVersion}
            onChange={(e) => onChangeTitleVersion({ label: e.target.value })}
            placeholder="default style"
          />
        </Field>
        <Field label="Title style">
          <div className="field-input read">{titleStyleName ?? "—"}</div>
        </Field>

        <div className="versions-list">
          {section.versions.map((v, i) => {
            const isActive = v.id === section.active_version_id;
            const canRemove = section.versions.length > 1;
            return (
              <div
                key={v.id}
                className={`vrow${isActive ? " active" : ""}`}
                onClick={() => onSelectVersion(v.id)}
              >
                <div className="vlabel">
                  <span className="vid">v{i + 1}</span>
                  <span className="vdesc">{v.label}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {canRemove ? (
                    <button
                      type="button"
                      className="vrow-remove"
                      title="Remove version"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveVersion(v.id);
                      }}
                    >
                      ✕
                    </button>
                  ) : null}
                  <span className={`vmark ${isActive ? "active" : "muted"}`}>
                    {isActive ? "●" : "↻"}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="vrow add" onClick={onAddVersion}>+ new version</div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── CLIP FLOW BODY ───────────── */

type ClipFlowBodyProps = {
  section: Section;
  project: Project;
  activeStill: NonNullable<Section["stills"][number]> | null;
  activeVersion:
    | (Section["versions"][number] & { kind: "clip" })
    | null;
  motionDirection: "in" | "out" | "left" | "right" | null;
  motionStillUrl: string | null;
  priorClipSections: Section[];
  modelHasKey: (modelId: string) => boolean;
  onUpdateStill: (
    stillId: string,
    patch: Partial<Omit<Section["stills"][number], "id">>,
  ) => void;
  onAddStill: () => void;
  onRemoveStill: (stillId: string) => void;
  onSelectStill: (stillId: string) => void;
  onUpdateClipVersion: (
    versionId: string,
    patch: {
      label?: string;
      motion?: Partial<{ prompt: string; model: string; duration_s: number }>;
      still_ref?: string | null;
      output_url?: string;
    },
  ) => void;
  onAddClipVersion: () => void;
  onRemoveClipVersion: (versionId: string) => void;
  onSelectVersion: (versionId: string) => void;
  onGenerateStill: () => void;
  onGenerateMotion: () => void;
};

function ClipFlowBody({
  section,
  project,
  activeStill,
  activeVersion,
  motionDirection,
  motionStillUrl,
  priorClipSections,
  modelHasKey,
  onUpdateStill,
  onAddStill,
  onRemoveStill,
  onSelectStill,
  onUpdateClipVersion,
  onAddClipVersion,
  onRemoveClipVersion,
  onSelectVersion,
  onGenerateStill,
  onGenerateMotion,
}: ClipFlowBodyProps) {
  const stillCost = activeStill ? imageModelCost(activeStill.model) : 0;
  const motionCost = activeVersion
    ? motionModelCost(activeVersion.motion.model, activeVersion.motion.duration_s)
    : 0;
  const stillNeedsKey =
    activeStill && !isImageModelFree(activeStill.model) && !modelHasKey(activeStill.model);
  const motionNeedsKey =
    activeVersion &&
    !isMotionModelFree(activeVersion.motion.model) &&
    !modelHasKey(activeVersion.motion.model);

  const updateStillLabel = useCallback(
    (label: string) => activeStill && onUpdateStill(activeStill.id, { label }),
    [activeStill, onUpdateStill],
  );
  const updateVersionLabel = useCallback(
    (label: string) => activeVersion && onUpdateClipVersion(activeVersion.id, { label }),
    [activeVersion, onUpdateClipVersion],
  );

  return (
    <div className="flow-body">
      {/* STAGE 1 — STILL */}
      <div className="stage">
        <div className="stage-title"><span className="num">01</span>STILL</div>

        <Field label="Image prompt">
          <textarea
            className="field-input tall"
            rows={3}
            value={activeStill?.image_prompt ?? ""}
            disabled={!activeStill}
            placeholder={activeStill ? "" : "+ new still to start"}
            onChange={(e) =>
              activeStill && onUpdateStill(activeStill.id, { image_prompt: e.target.value })
            }
          />
        </Field>

        <Field label="Still label">
          <input
            className="field-input"
            value={activeStill?.label ?? ""}
            disabled={!activeStill}
            onChange={(e) => updateStillLabel(e.target.value)}
            placeholder="describe this still"
          />
        </Field>

        <div className="field-row three">
          <Field label="Model">
            <div className="field-pill">
              <select
                value={activeStill?.model ?? "flux-1.1-pro"}
                disabled={!activeStill}
                onChange={(e) =>
                  activeStill && onUpdateStill(activeStill.id, { model: e.target.value })
                }
              >
                {IMAGE_MODELS.map((m) => {
                  const needsKey = !m.free && !modelHasKey(m.id);
                  return (
                    <option key={m.id} value={m.id}>
                      {m.label}{needsKey ? "  (key required)" : ""}
                    </option>
                  );
                })}
              </select>
              <span className="caret">▾</span>
            </div>
          </Field>
          <Field label="Input">
            <div className="field-pill">
              <select
                value={activeStill?.input_ref ?? ""}
                disabled={!activeStill}
                onChange={(e) =>
                  activeStill &&
                  onUpdateStill(activeStill.id, { input_ref: e.target.value || null })
                }
              >
                <option value="">none</option>
                {priorClipSections.map((s) => (
                  <option key={s.id} value={`section:${s.id}:last_frame`}>
                    {s.index.toString().padStart(2, "0")} last frame
                  </option>
                ))}
              </select>
              <span className="caret">▾</span>
            </div>
          </Field>
          <Field label="Cost">
            <div className="field-pill cost">{formatCost(stillCost)}</div>
          </Field>
        </div>

        <div className="preview-row">
          <div className={`preview-box${activeStill?.output_url ? " has-image" : ""}`}>
            {activeStill?.output_url ? (
              <img
                key={activeStill.output_url}
                src={activeStill.output_url}
                alt={activeStill.label}
                className="preview-img"
              />
            ) : null}
            {activeStill ? (
              <span className="vbadge">
                s{section.stills.findIndex((s) => s.id === activeStill.id) + 1} · active
              </span>
            ) : null}
            <span className="play">▶︎</span>
            <span className="time">still</span>
          </div>
          <div className="versions-list">
            {section.stills.map((still, i) => {
              const isActive = still.id === section.active_still_id;
              const canRemove = section.stills.length > 1;
              return (
                <div
                  key={still.id}
                  className={`vrow${isActive ? " active" : ""}`}
                  onClick={() => onSelectStill(still.id)}
                >
                  <div className="vlabel">
                    <span className="vid">s{i + 1}</span>
                    <span className="vdesc">{still.label}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {canRemove ? (
                      <button
                        type="button"
                        className="vrow-remove"
                        title="Remove still"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveStill(still.id);
                        }}
                      >
                        ✕
                      </button>
                    ) : null}
                    <span className={`vmark ${isActive ? "active" : "muted"}`}>
                      {isActive ? "●" : "↻"}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="vrow add" onClick={onAddStill}>+ new still</div>
          </div>
        </div>

        <div className="gen-row">
          <span className={`gen-cost ${stillNeedsKey ? "warn" : ""}`}>
            {stillNeedsKey ? "⊘ key required · " : ""}
            {formatCost(stillCost)} per still
          </span>
          <button
            type="button"
            className="btn primary"
            disabled={!activeStill}
            onClick={onGenerateStill}
          >
            ⏵ Generate still
          </button>
        </div>
      </div>

      {/* STAGE 2 — MOTION */}
      <div className="stage">
        <div className="stage-title"><span className="num">02</span>MOTION</div>

        <Field label="Motion prompt">
          <textarea
            className="field-input tall"
            rows={3}
            value={activeVersion?.motion.prompt ?? ""}
            disabled={!activeVersion}
            placeholder={activeVersion ? "" : "+ new version to start"}
            onChange={(e) =>
              activeVersion &&
              onUpdateClipVersion(activeVersion.id, { motion: { prompt: e.target.value } })
            }
          />
        </Field>

        <Field label="Version label">
          <input
            className="field-input"
            value={activeVersion?.label ?? ""}
            disabled={!activeVersion}
            onChange={(e) => updateVersionLabel(e.target.value)}
            placeholder="describe this take"
          />
        </Field>

        <div className="field-row three">
          <Field label="Model">
            <div className="field-pill">
              <select
                value={activeVersion?.motion.model ?? "runway-gen4"}
                disabled={!activeVersion}
                onChange={(e) =>
                  activeVersion &&
                  onUpdateClipVersion(activeVersion.id, { motion: { model: e.target.value } })
                }
              >
                {MOTION_MODELS.map((m) => {
                  const needsKey = !m.free && !modelHasKey(m.id);
                  return (
                    <option key={m.id} value={m.id}>
                      {m.label}{needsKey ? "  (key required)" : ""}
                    </option>
                  );
                })}
              </select>
              <span className="caret">▾</span>
            </div>
          </Field>
          <Field label="Duration">
            <div className="field-pill">
              <select
                value={activeVersion?.motion.duration_s ?? section.duration_s}
                disabled={!activeVersion}
                onChange={(e) =>
                  activeVersion &&
                  onUpdateClipVersion(activeVersion.id, {
                    motion: { duration_s: Number(e.target.value) },
                  })
                }
              >
                {DURATION_OPTIONS_S.map((d) => (
                  <option key={d} value={d}>{d.toFixed(1)}s</option>
                ))}
              </select>
              <span className="caret">▾</span>
            </div>
          </Field>
          <Field label="Cost">
            <div className="field-pill cost">{formatCost(motionCost)}</div>
          </Field>
        </div>

        <div className="preview-row">
          <div className={`preview-box motion${motionStillUrl ? " has-image" : ""}`}>
            {motionStillUrl ? (
              <img
                key={`${motionStillUrl}|${motionDirection}|${activeVersion?.motion.duration_s ?? 0}`}
                src={motionStillUrl}
                alt="motion preview"
                className={`preview-img kb kb-${motionDirection}`}
                style={{ animationDuration: `${activeVersion?.motion.duration_s ?? 3}s` }}
              />
            ) : null}
            {activeVersion ? (
              <span className="vbadge">
                v{section.versions.findIndex((v) => v.id === activeVersion.id) + 1} · active
              </span>
            ) : null}
            <span className="play">▶︎</span>
            <span className="time">
              0:00 / {(activeVersion?.motion.duration_s ?? section.duration_s).toFixed(1)}
            </span>
          </div>
          <div className="versions-list">
            {section.versions.map((v, i) => {
              const isActive = v.id === section.active_version_id;
              const canRemove = section.versions.length > 1;
              return (
                <div
                  key={v.id}
                  className={`vrow${isActive ? " active" : ""}`}
                  onClick={() => onSelectVersion(v.id)}
                >
                  <div className="vlabel">
                    <span className="vid">v{i + 1}</span>
                    <span className="vdesc">{v.label}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {canRemove ? (
                      <button
                        type="button"
                        className="vrow-remove"
                        title="Remove version"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveClipVersion(v.id);
                        }}
                      >
                        ✕
                      </button>
                    ) : null}
                    <span className={`vmark ${isActive ? "active" : "muted"}`}>
                      {isActive ? "●" : "↻"}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="vrow add" onClick={onAddClipVersion}>+ new version</div>
          </div>
        </div>

        <div className="gen-row">
          <span className={`gen-cost ${motionNeedsKey ? "warn" : ""}`}>
            {motionNeedsKey ? "⊘ key required · " : ""}
            {formatCost(motionCost)} per version
          </span>
          <button
            type="button"
            className="btn primary"
            disabled={!activeVersion}
            onClick={onGenerateMotion}
          >
            ⏵ Generate motion
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── LUT EXPORT ───────────── */

function buildCubeLUT(grade: Grade): string {
  const size = 17;
  const adj = grade.adjustments;
  const exposure = typeof adj.exposure === "number" ? adj.exposure : 0;
  const contrast = typeof adj.contrast === "number" ? adj.contrast / 100 : 0;
  const mids = typeof adj.mids === "string" ? adj.mids : "neutral";
  const blacks = typeof adj.blacks === "string" ? adj.blacks : "neutral";
  const shadow = typeof adj.shadow_tint === "string" ? adj.shadow_tint : "neutral";

  const tintMap: Record<string, [number, number, number]> = {
    neutral: [0, 0, 0],
    teal:    [-0.04, 0.02, 0.06],
    warm:    [0.05, 0.01, -0.04],
    violet:  [0.03, -0.02, 0.05],
    cool:    [-0.03, 0, 0.05],
  };
  const midShift = mids === "warm" ? [0.03, 0.01, -0.02] : mids === "cool" ? [-0.02, 0, 0.03] : [0, 0, 0];
  const tint = tintMap[shadow] ?? [0, 0, 0];

  const lines: string[] = [];
  lines.push(`# AI Cinema grade: ${grade.name}`);
  lines.push(`# exposure=${exposure} contrast=${contrast} mids=${mids} blacks=${blacks} shadow=${shadow}`);
  lines.push(`LUT_3D_SIZE ${size}`);
  lines.push("DOMAIN_MIN 0.0 0.0 0.0");
  lines.push("DOMAIN_MAX 1.0 1.0 1.0");

  const channel = (v: number, i: 0 | 1 | 2): number => {
    let x = v;
    x = x + exposure * 0.5;
    x = (x - 0.5) * (1 + contrast) + 0.5;
    const shadowWeight = Math.max(0, 1 - x * 2);
    x += tint[i] * shadowWeight;
    const midWeight = 1 - Math.abs(x - 0.5) * 2;
    x += midShift[i] * Math.max(0, midWeight);
    if (blacks === "crushed") x = x < 0.18 ? x * 0.7 : x;
    else if (blacks === "lifted") x = x < 0.18 ? Math.min(0.25, x + 0.05) : x;
    return Math.max(0, Math.min(1, x));
  };

  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const rv = r / (size - 1);
        const gv = g / (size - 1);
        const bv = b / (size - 1);
        lines.push(
          `${channel(rv, 0).toFixed(5)} ${channel(gv, 1).toFixed(5)} ${channel(bv, 2).toFixed(5)}`,
        );
      }
    }
  }
  return lines.join("\n");
}

function downloadCubeLUT(grade: Grade): void {
  const content = buildCubeLUT(grade);
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = grade.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "grade";
  a.href = url;
  a.download = `${safe}.cube`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ───────────── RENDER DIALOG ───────────── */

function RenderDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const sections = project.sections;
  const transitions = project.transitions;
  const trByTo = useMemo(() => {
    const m = new Map<string, Transition>();
    for (const t of transitions) m.set(t.to_section_id, t);
    return m;
  }, [transitions]);

  let stillCostTotal = 0;
  let motionCostTotal = 0;
  for (const s of sections) {
    if (s.type !== "clip") continue;
    for (const still of s.stills) {
      if (still.output_url) stillCostTotal += imageModelCost(still.model);
    }
    for (const v of s.versions) {
      if (v.kind === "clip" && v.output_url) {
        motionCostTotal += motionModelCost(v.motion.model, v.motion.duration_s);
      }
    }
  }
  const activeMotionCost = sections.reduce((acc, s) => {
    if (s.type !== "clip") return acc;
    const active = s.versions.find((v) => v.id === s.active_version_id);
    if (active && active.kind === "clip") {
      return acc + motionModelCost(active.motion.model, active.motion.duration_s);
    }
    return acc;
  }, 0);
  const activeStillCost = sections.reduce((acc, s) => {
    if (s.type !== "clip") return acc;
    const activeVer = s.versions.find((v) => v.id === s.active_version_id);
    const stillId = activeVer && activeVer.kind === "clip" ? activeVer.still_ref : s.active_still_id;
    const still = stillId ? s.stills.find((st) => st.id === stillId) : null;
    if (still) return acc + imageModelCost(still.model);
    return acc;
  }, 0);

  const readiness = sections.map((s) => {
    if (s.type === "title") {
      const v = s.versions.find((x) => x.id === s.active_version_id);
      const ready = v && v.kind === "title" && v.text.trim().length > 0;
      return { id: s.id, label: s.title, ready, reason: ready ? "title text set" : "missing title text" };
    }
    const v = s.versions.find((x) => x.id === s.active_version_id);
    if (!v || v.kind !== "clip") {
      return { id: s.id, label: s.title, ready: false, reason: "no active version" };
    }
    if (!v.output_url) {
      return { id: s.id, label: s.title, ready: false, reason: "motion not generated" };
    }
    return { id: s.id, label: s.title, ready: true, reason: "ready" };
  });
  const allReady = readiness.every((r) => r.ready);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">// RENDER</div>
            <div className="modal-sub">
              {project.name} · {project.duration_s.toFixed(1)}s · {project.aspect.replace(":", " : ")} · {sections.length} sections
            </div>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>✕ Close</button>
        </div>

        <div className="modal-body">
          <div className="modal-section">
            <div className="modal-section-title">// SHOT LIST</div>
            <ol className="shot-list">
              {sections.map((s, i) => {
                const r = readiness[i];
                const tr = trByTo.get(s.id);
                const activeVer = s.versions.find((v) => v.id === s.active_version_id);
                const versionLabel =
                  activeVer
                    ? `v${s.versions.findIndex((v) => v.id === activeVer.id) + 1} — ${activeVer.label}`
                    : "—";
                return (
                  <li key={s.id} className={`shot-row ${r.ready ? "ok" : "miss"}`}>
                    <span className="shot-idx">{s.index.toString().padStart(2, "0")}</span>
                    <span className="shot-type">{s.type.toUpperCase()}</span>
                    <span className="shot-title">{s.title}</span>
                    <span className="shot-version">{versionLabel}</span>
                    <span className="shot-dur">{s.duration_s.toFixed(1)}s</span>
                    <span className="shot-trans">
                      {tr ? formatTransition(tr.type, tr.duration_s) : "—"}
                    </span>
                    <span className={`shot-status ${r.ready ? "ok" : "miss"}`}>
                      {r.ready ? "● ready" : "○ " + r.reason}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">// AUDIO</div>
            <div className="audio-summary">
              <div className="audio-line">
                <span className="al-label">VO</span>
                <span className="al-value">
                  {project.vo_segments.length} segment{project.vo_segments.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="audio-line">
                <span className="al-label">Music</span>
                <span className="al-value">
                  {project.music_track?.name ?? "—"} · {project.music_track?.model ?? "—"}
                </span>
              </div>
              <div className="audio-line">
                <span className="al-label">Grade</span>
                <span className="al-value">{project.grade?.name ?? "—"}</span>
              </div>
              <div className="audio-line">
                <span className="al-label">Brief</span>
                <span className="al-value">{project.brief?.name ?? "—"}</span>
              </div>
            </div>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">// COST</div>
            <div className="cost-grid">
              <div>
                <div className="cost-label">Stills (active)</div>
                <div className="cost-value">{formatCost(activeStillCost)}</div>
              </div>
              <div>
                <div className="cost-label">Motion (active)</div>
                <div className="cost-value">{formatCost(activeMotionCost)}</div>
              </div>
              <div>
                <div className="cost-label">Spent total</div>
                <div className="cost-value muted">
                  {formatCost(stillCostTotal + motionCostTotal)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className={`render-status ${allReady ? "ok" : "miss"}`}>
            {allReady
              ? "All sections ready"
              : `${readiness.filter((r) => !r.ready).length} section${
                  readiness.filter((r) => !r.ready).length === 1 ? "" : "s"
                } not ready`}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" disabled title="Render pipeline ships next">
              ▶︎ Render (ffmpeg.wasm pending)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── PROVIDERS DIALOG ───────────── */

function ProvidersDialog({
  keys,
  onSetKey,
  onRemoveKey,
  onClose,
}: {
  keys: Partial<Record<ProviderId, string>>;
  onSetKey: (id: ProviderId, key: string) => void;
  onRemoveKey: (id: ProviderId) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">// PROVIDERS</div>
            <div className="modal-sub">
              Bring your own model · keys stay in your browser · calls go direct to the provider
            </div>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>✕ Close</button>
        </div>

        <div className="modal-body">
          <div className="providers-notice">
            <strong>Zero-server stance.</strong> Your keys live in this browser&apos;s localStorage and
            are never sent to any AI Cinema server. Export does not include keys.
          </div>

          <div className="providers-list">
            {PROVIDERS.map((p) => {
              const stored = keys[p.id] ?? "";
              const connected = stored.trim().length > 0;
              return (
                <ProviderRow
                  key={p.id}
                  providerId={p.id}
                  name={p.name}
                  surfaces={p.surfaces}
                  signupUrl={p.signup_url}
                  notes={p.notes}
                  keyPrefix={p.key_prefix}
                  storedKey={stored}
                  connected={connected}
                  onSetKey={(k) => onSetKey(p.id, k)}
                  onRemoveKey={() => onRemoveKey(p.id)}
                />
              );
            })}
          </div>
        </div>

        <div className="modal-foot">
          <span className="render-status">
            {Object.values(keys).filter((v) => v && v.trim()).length} of {PROVIDERS.length} configured
          </span>
          <button type="button" className="btn ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function ProviderRow({
  providerId,
  name,
  surfaces,
  signupUrl,
  notes,
  keyPrefix,
  storedKey,
  connected,
  onSetKey,
  onRemoveKey,
}: {
  providerId: ProviderId;
  name: string;
  surfaces: ("image" | "motion" | "voice" | "music" | "text")[];
  signupUrl: string;
  notes?: string;
  keyPrefix?: string;
  storedKey: string;
  connected: boolean;
  onSetKey: (key: string) => void;
  onRemoveKey: () => void;
}) {
  const [editing, setEditing] = useState(!connected);
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);

  const commit = () => {
    if (!draft.trim()) return;
    onSetKey(draft);
    setDraft("");
    setEditing(false);
    setShow(false);
  };

  return (
    <div className={`provider-row ${connected ? "connected" : ""}`}>
      <div className="provider-head">
        <div className="provider-id">
          <span className={`prov-dot ${connected ? "" : "warn"}`} />
          <span className="prov-name">{name}</span>
          <span className="prov-tag">{providerId}</span>
        </div>
        <div className="provider-surfaces">
          {surfaces.map((s) => (
            <span key={s} className="surface-tag">{s}</span>
          ))}
        </div>
      </div>
      {notes ? <div className="provider-notes">{notes}</div> : null}
      <div className="provider-key">
        {editing ? (
          <>
            <input
              className="field-input"
              type={show ? "text" : "password"}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder={keyPrefix ? `${keyPrefix}…` : "API key"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
                if (e.key === "Escape") {
                  setEditing(connected ? false : true);
                  setDraft("");
                }
              }}
            />
            <button
              type="button"
              className="btn ghost provider-act"
              onClick={() => setShow((v) => !v)}
            >
              {show ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className="btn provider-act"
              disabled={!draft.trim()}
              onClick={commit}
            >
              Save
            </button>
            {connected ? (
              <button
                type="button"
                className="btn ghost provider-act"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                }}
              >
                Cancel
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="field-input read masked">{maskKey(storedKey)}</div>
            <button
              type="button"
              className="btn ghost provider-act"
              onClick={() => setEditing(true)}
            >
              Replace
            </button>
            <button
              type="button"
              className="btn ghost provider-act danger"
              onClick={() => {
                if (confirm(`Remove ${name} API key from this browser?`)) onRemoveKey();
              }}
            >
              Remove
            </button>
          </>
        )}
      </div>
      <div className="provider-meta">
        <a className="provider-link" href={signupUrl} target="_blank" rel="noreferrer">
          Get a {name} key ↗
        </a>
      </div>
    </div>
  );
}
