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
import { useProjectLibrary } from "@/lib/projects";
import { useHistory } from "@/lib/history";
import { toast, useToasts } from "@/lib/toast";
import { useWaveform } from "@/lib/waveform";
import { useGenState, stillJobKey, motionJobKey, type GenSlot } from "@/lib/genstate";
import {
  composePromptWithBrief,
  fetchAsDataUrl,
  imageModelSupportsReference,
  isReplicateImageModel,
  isReplicateMotionModel,
  isReplicateMusicModel,
  runReplicateImage,
  runReplicateMotion,
  runReplicateMusic,
} from "@/lib/replicate";
import { extractLastFrameDataUrl, parseLastFrameRef } from "@/lib/video";
import { runElevenLabsMusic, runElevenLabsTTS, voiceList } from "@/lib/elevenlabs";
import { describeRenderPlan, renderProject, terminateFFmpeg, type RenderProgress } from "@/lib/render";
import { buildCubeLUT } from "@/lib/grade";

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

function Waveform({
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

/* ───────────── PAGE ───────────── */

export default function HomePage() {
  const project = useStore((s) => s.project);
  const activeSectionId = useStore((s) => s.activeSectionId);
  const activeSection = useStore(selectActiveSection);
  const setActiveSection = useStore((s) => s.setActiveSection);
  const setProject = useStore((s) => s.setProject);
  const updateProjectMeta = useStore((s) => s.updateProjectMeta);
  const setActiveVersionStore = useStore((s) => s.setActiveVersion);
  const addClipSection = useStore((s) => s.addClipSection);
  const addTitleSection = useStore((s) => s.addTitleSection);
  const removeSection = useStore((s) => s.removeSection);
  const moveSection = useStore((s) => s.moveSection);
  const moveSectionTo = useStore((s) => s.moveSectionTo);
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
      Promise.resolve(useProjectLibrary.persist.rehydrate()),
    ]).finally(() => setHydrated(true));
  }, []);

  const historyPastLen = useHistory((s) => s.past.length);
  const historyFutureLen = useHistory((s) => s.future.length);

  const projectRef = useRef(project);
  const skipNextHistory = useRef(false);
  const pendingHistoryPush = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (projectRef.current === project) return;
    if (skipNextHistory.current) {
      skipNextHistory.current = false;
      projectRef.current = project;
      return;
    }
    const prev = projectRef.current;
    projectRef.current = project;
    if (pendingHistoryPush.current) clearTimeout(pendingHistoryPush.current);
    pendingHistoryPush.current = setTimeout(() => {
      useHistory.getState().push(prev);
      pendingHistoryPush.current = null;
    }, 350);
  }, [project]);

  useEffect(() => () => {
    if (pendingHistoryPush.current) clearTimeout(pendingHistoryPush.current);
  }, []);

  const handleUndo = useCallback(() => {
    if (pendingHistoryPush.current) {
      clearTimeout(pendingHistoryPush.current);
      pendingHistoryPush.current = null;
      useHistory.getState().push(projectRef.current);
    }
    const previous = useHistory.getState().undo(project);
    if (!previous) return;
    skipNextHistory.current = true;
    setProject(previous);
  }, [project, setProject]);

  const handleRedo = useCallback(() => {
    if (pendingHistoryPush.current) {
      clearTimeout(pendingHistoryPush.current);
      pendingHistoryPush.current = null;
    }
    const next = useHistory.getState().redo(project);
    if (!next) return;
    skipNextHistory.current = true;
    setProject(next);
  }, [project, setProject]);

  const projectStubs = useProjectLibrary((s) => s.order.map((id) => s.projects[id]).filter(Boolean));
  const savedProjectsMap = useProjectLibrary((s) => s.projects);
  const savedSnapshot = savedProjectsMap[project.id];
  const isDirty = !savedSnapshot || savedSnapshot.updated_at !== project.updated_at;
  const isInLibrary = !!savedSnapshot;

  const configuredKeyCountEarly = Object.values(providerKeys).filter((v) => v && v.trim()).length;

  const [welcomeDismissed, setWelcomeDismissed] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("ai-cinema:welcome-dismissed") !== "1") {
      setWelcomeDismissed(false);
    }
  }, []);
  const dismissWelcome = () => {
    try { localStorage.setItem("ai-cinema:welcome-dismissed", "1"); } catch {}
    setWelcomeDismissed(true);
  };
  const showWelcome =
    hydrated && !welcomeDismissed && projectStubs.length === 0 && configuredKeyCountEarly === 0;

  const sessionSpent = useMemo(() => {
    let total = 0;
    for (const s of project.sections) {
      if (s.type !== "clip") continue;
      for (const st of s.stills) {
        if (st.output_url && /^https?:\/\//.test(st.output_url)) {
          total += imageModelCost(st.model);
        }
      }
      for (const v of s.versions) {
        if (v.kind === "clip" && v.output_url && /^https?:\/\//.test(v.output_url)) {
          total += motionModelCost(v.motion.model, v.motion.duration_s);
        }
      }
    }
    return total;
  }, [project.sections]);
  const saveProjectToLibrary = useProjectLibrary((s) => s.saveProject);
  const loadProjectFromLibrary = useProjectLibrary((s) => s.loadProject);
  const renameProjectInLibrary = useProjectLibrary((s) => s.renameProject);
  const deleteProjectFromLibrary = useProjectLibrary((s) => s.deleteProject);
  const duplicateProjectInLibrary = useProjectLibrary((s) => s.duplicateProject);

  const configuredKeyCount = configuredKeyCountEarly;

  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null);
  const [timelineVersionMenuId, setTimelineVersionMenuId] = useState<string | null>(null);
  const [editingTransitionId, setEditingTransitionId] = useState<string | null>(null);
  const [editingVOId, setEditingVOId] = useState<string | null>(null);
  const [lookOpen, setLookOpen] = useState<null | "brief" | "grade" | "music" | "title">(null);
  const [dragSectionId, setDragSectionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; side: "before" | "after" } | null>(null);
  const [renderOpen, setRenderOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [playPosition, setPlayPosition] = useState<number | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPreview = useCallback(() => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    playTimerRef.current = null;
    setPlayPosition(null);
  }, []);

  const [voJobs, setVoJobs] = useState<Record<string, { status: "running" | "error"; error?: string }>>({});
  const [musicJob, setMusicJob] = useState<{ status: "running" | "error"; error?: string } | null>(null);

  const handleGenerateMusic = useCallback(async () => {
    const music = project.music_track;
    if (!music || !music.prompt.trim()) {
      toast.warn("Add a music prompt first.");
      return;
    }
    setMusicJob({ status: "running" });
    try {
      let dataUrl: string;
      if (isReplicateMusicModel(music.model)) {
        const key = providerKeys.replicate;
        if (!key) {
          setMusicJob(null);
          if (confirm("Stable Audio runs on Replicate. Open Providers to add a key?")) {
            setProvidersOpen(true);
          }
          return;
        }
        const url = await runReplicateMusic({
          model: music.model,
          prompt: music.prompt,
          durationSeconds: project.duration_s,
          apiToken: key,
        });
        dataUrl = await fetchAsDataUrl(url);
      } else {
        const key = providerKeys.elevenlabs;
        if (!key) {
          setMusicJob(null);
          if (confirm("ElevenLabs needs an API key to generate music. Open Providers to add one?")) {
            setProvidersOpen(true);
          }
          return;
        }
        dataUrl = await runElevenLabsMusic({
          prompt: music.prompt,
          durationMs: Math.round(project.duration_s * 1000),
          apiKey: key,
        });
      }
      updateMusic({ output_url: dataUrl });
      setMusicJob(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMusicJob({ status: "error", error: message });
    }
  }, [project.music_track, project.duration_s, providerKeys.elevenlabs, providerKeys.replicate, updateMusic]);

  const handleGenerateVO = useCallback(
    async (segmentId: string) => {
      const seg = project.vo_segments.find((v) => v.id === segmentId);
      if (!seg) return;
      const key = providerKeys.elevenlabs;
      if (!key) {
        if (
          confirm(
            "ElevenLabs needs an API key to generate voice. Open Providers to add one?",
          )
        ) {
          setProvidersOpen(true);
        }
        return;
      }
      if (!seg.text.trim()) {
        toast.warn("Add text to the VO segment first.");
        return;
      }
      setVoJobs((j) => ({ ...j, [segmentId]: { status: "running" } }));
      try {
        const dataUrl = await runElevenLabsTTS({
          voice: seg.voice,
          text: seg.text,
          apiKey: key,
        });
        updateVOSegment(segmentId, { output_url: dataUrl });
        setVoJobs((j) => {
          const next = { ...j };
          delete next[segmentId];
          return next;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setVoJobs((j) => ({ ...j, [segmentId]: { status: "error", error: message } }));
      }
    },
    [project.vo_segments, providerKeys.elevenlabs, updateVOSegment],
  );

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editable =
        tag === "input" || tag === "textarea" || target?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && (e.key === "z" || e.key === "Z")) {
        if (editable) return;
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        if (editable) return;
        e.preventDefault();
        handleRedo();
        return;
      }
      if (mod && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        saveProjectToLibrary(project);
        toast.success("Saved to library", project.name);
        return;
      }
      if (editable) return;

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setHelpOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") {
        if (helpOpen) { setHelpOpen(false); return; }
        if (renderOpen) { setRenderOpen(false); return; }
        if (providersOpen) { setProvidersOpen(false); return; }
        if (lookOpen) { setLookOpen(null); return; }
        if (activeSectionId) { setActiveSection(null); return; }
        return;
      }
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (playPosition !== null) stopPreview();
        else startPreview();
        return;
      }
      if (e.key === "ArrowLeft") {
        if (!project.sections.length) return;
        e.preventDefault();
        const idx = project.sections.findIndex((s) => s.id === activeSectionId);
        const nextIdx = idx <= 0 ? project.sections.length - 1 : idx - 1;
        setActiveSection(project.sections[nextIdx].id);
        return;
      }
      if (e.key === "ArrowRight") {
        if (!project.sections.length) return;
        e.preventDefault();
        const idx = project.sections.findIndex((s) => s.id === activeSectionId);
        const nextIdx = idx < 0 || idx === project.sections.length - 1 ? 0 : idx + 1;
        setActiveSection(project.sections[nextIdx].id);
        return;
      }
      if (activeSectionId && (e.key === "Delete" || e.key === "Backspace")) {
        const sec = project.sections.find((s) => s.id === activeSectionId);
        if (!sec) return;
        e.preventDefault();
        if (confirm(`Delete section "${sec.title}"?`)) {
          removeSection(activeSectionId);
          toast.info(`Removed "${sec.title}"`);
        }
        return;
      }
      if (activeSectionId && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        duplicateSection(activeSectionId);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    handleUndo,
    handleRedo,
    helpOpen,
    renderOpen,
    providersOpen,
    lookOpen,
    activeSectionId,
    project.sections,
    setActiveSection,
    playPosition,
    startPreview,
    stopPreview,
    removeSection,
    duplicateSection,
    project,
    saveProjectToLibrary,
  ]);

  const handleReset = useCallback(() => {
    if (confirm("Reset project to defaults? Unsaved work will be lost.")) {
      resetProject();
      toast.info("Project reset", "Back to the Product Reveal seed.");
    }
  }, [resetProject]);
  const handleExportLUT = useCallback(() => {
    if (!project.grade) return;
    downloadCubeLUT(project.grade);
    toast.success(".cube LUT exported", `${project.grade.name} · 17³ entries`);
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
    else toast.error("Import failed", result.error);
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

      {showWelcome ? (
        <div className="welcome-banner">
          <div className="welcome-body">
            <strong>Welcome to AI Cinema.</strong>
            <span>
              You&apos;re in fully usable free-preview mode — Pollinations stills, Ken Burns motion, ⓘ
              no keys needed.
            </span>
            <span>
              Add real provider keys via 🔑 Keys to unlock Flux, Runway-class motion, ElevenLabs voice and music. Try a
              starter from ⚀ Templates to see the timeline come to life.
            </span>
          </div>
          <div className="welcome-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                dismissWelcome();
                setProvidersOpen(true);
              }}
            >
              🔑 Add a key
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                dismissWelcome();
                setTemplatesOpen(true);
              }}
            >
              ⚀ Templates
            </button>
            <button type="button" className="btn ghost" onClick={dismissWelcome}>
              ✕ Got it
            </button>
          </div>
        </div>
      ) : null}

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
            {isInLibrary ? (
              <span
                className={`save-pill ${isDirty ? "dirty" : "saved"}`}
                title={
                  isDirty
                    ? "Unsaved changes since last library snapshot"
                    : "In sync with the library snapshot"
                }
              >
                {isDirty ? "● UNSAVED" : "✓ SAVED"}
              </span>
            ) : (
              <span className="save-pill new" title="Not in your project library yet">
                NEW
              </span>
            )}
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
              onClick={() => setProjectsOpen((o) => !o)}
              title="Project library"
            >
              ▤ Projects{projectStubs.length > 0 ? ` (${projectStubs.length})` : ""}
            </button>
            <Popover
              open={projectsOpen}
              onClose={() => setProjectsOpen(false)}
              className="templates-menu"
            >
              <div className="templates-head">// PROJECT LIBRARY</div>
              <button
                type="button"
                className="template-item"
                onClick={() => {
                  saveProjectToLibrary(project);
                  setProjectsOpen(false);
                }}
              >
                <span className="tpl-name">＋ Save current</span>
                <span className="tpl-desc">snapshot &ldquo;{project.name}&rdquo; · {project.duration_s.toFixed(1)}s · {project.sections.length} sections</span>
              </button>
              {projectStubs.length === 0 ? (
                <div className="proj-empty">no saved projects yet</div>
              ) : (
                projectStubs.map((p) => {
                  const isOpen = p.id === project.id;
                  return (
                    <div key={p.id} className="proj-row">
                      <button
                        type="button"
                        className={`template-item proj-pick ${isOpen ? "active" : ""}`}
                        onClick={() => {
                          if (isOpen) {
                            setProjectsOpen(false);
                            return;
                          }
                          if (project.updated_at) saveProjectToLibrary(project);
                          const loaded = loadProjectFromLibrary(p.id);
                          if (loaded) setProject(loaded);
                          setProjectsOpen(false);
                        }}
                      >
                        <span className="tpl-name">
                          {isOpen ? "● " : ""}{p.name}
                        </span>
                        <span className="tpl-desc">
                          {p.aspect.replace(":", " : ")} · {p.duration_s.toFixed(1)}s · {p.sections.length} sections · {new Date(p.updated_at).toLocaleDateString()}
                        </span>
                      </button>
                      <div className="proj-actions">
                        <button
                          type="button"
                          className="btn ghost proj-act"
                          title="Rename"
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = prompt("Rename project:", p.name);
                            if (next && next.trim()) {
                              renameProjectInLibrary(p.id, next.trim());
                              if (isOpen) updateProjectMeta({ name: next.trim() });
                            }
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="btn ghost proj-act"
                          title="Duplicate"
                          onClick={(e) => {
                            e.stopPropagation();
                            const copy = duplicateProjectInLibrary(p.id);
                            if (copy) setProject(copy);
                            setProjectsOpen(false);
                          }}
                        >
                          ⎘
                        </button>
                        <button
                          type="button"
                          className="btn ghost proj-act danger"
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete "${p.name}" from library? (current project stays loaded)`)) {
                              deleteProjectFromLibrary(p.id);
                            }
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </Popover>
          </span>
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
          <button
            type="button"
            className="btn ghost"
            onClick={handleUndo}
            disabled={historyPastLen === 0}
            title="Undo (⌘Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={handleRedo}
            disabled={historyFutureLen === 0}
            title="Redo (⇧⌘Z)"
          >
            ↷
          </button>
          <button type="button" className="btn ghost" onClick={handleReset} title="Reset to defaults">↺ Reset</button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>
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
            job={musicJob ?? undefined}
            hasKey={!!providerKeys.elevenlabs}
            durationS={project.duration_s}
            onChange={updateMusic}
            onLoadPreset={(item) => {
              const { id: _drop, ...rest } = item;
              updateMusic(rest);
            }}
            onSaveAs={(name) => project.music_track && saveMusicToLibrary(project.music_track, name)}
            onRemovePreset={(id) => removeLibraryItem("music", id)}
            onRenamePreset={(id, name) => renameLibraryItem("music", id, name)}
            onGenerate={handleGenerateMusic}
            onDismissError={() => setMusicJob(null)}
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

      <PreviewStage
        project={project}
        playPosition={playPosition}
        activeSectionId={activeSectionId}
        isPlaying={playPosition !== null}
        onTogglePlay={togglePreview}
        onStop={stopPreview}
      />

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
            const activeVer = section.versions.find((v) => v.id === section.active_version_id);
            const readyKind: "ready" | "still" | "draft" | "missing" = (() => {
              if (section.type === "title") {
                return activeVer && activeVer.kind === "title" && activeVer.text.trim().length > 0
                  ? "ready"
                  : "missing";
              }
              if (activeVer && activeVer.kind === "clip" && activeVer.output_url) return "ready";
              const stillId = activeVer && activeVer.kind === "clip" ? activeVer.still_ref ?? section.active_still_id : section.active_still_id;
              const still = stillId ? section.stills.find((s) => s.id === stillId) : null;
              if (still?.output_url) return "still";
              return empty ? "missing" : "draft";
            })();
            return (
              <div
                key={section.id}
                className={`clip${isActive ? " active" : ""}${empty ? " empty" : ""}${isPreviewing ? " previewing" : ""}${
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
                <div className="clip-num">
                  <span className={`clip-dot clip-dot-${readyKind}`} title={
                    readyKind === "ready" ? "Motion rendered" :
                    readyKind === "still" ? "Still ready, motion pending" :
                    readyKind === "draft" ? "Draft — nothing generated" :
                    "Missing"
                  } />
                  {section.index.toString().padStart(2, "0")} // {section.type.toUpperCase()}
                </div>
                {(() => {
                  const v = section.versions.find((x) => x.id === section.active_version_id);
                  const stillRef = v && v.kind === "clip" ? v.still_ref ?? section.active_still_id : section.active_still_id;
                  const still = stillRef ? section.stills.find((s) => s.id === stillRef) : null;
                  const thumb = still?.output_url;
                  const isVideo = v && v.kind === "clip" && v.output_url && /^https?:\/\//.test(v.output_url);
                  if (section.type === "title") {
                    return (
                      <div
                        className="clip-thumb title"
                        style={{
                          background: project.title_settings?.background_color ?? "#0a0908",
                          color: project.title_settings?.color ?? "#f4f1ea",
                        }}
                      >
                        <span>
                          {v && v.kind === "title" ? v.text.slice(0, 16) : "TITLE"}
                        </span>
                      </div>
                    );
                  }
                  if (thumb) {
                    return (
                      <div className="clip-thumb">
                        <img src={thumb} alt={section.title} />
                        {isVideo ? <span className="clip-thumb-badge">▶</span> : null}
                      </div>
                    );
                  }
                  return <div className="clip-thumb empty">no still</div>;
                })()}
                <div className="clip-title">{section.title}</div>
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
                  className={`vo-seg ${seg.output_url ? "voiced" : ""}`}
                  onClick={() =>
                    setEditingVOId(editingVOId === seg.id ? null : seg.id)
                  }
                >
                  <span className="vo-seg-head">
                    v{i + 1} {seg.output_url ? "♪ " : ""}— <span className="vo-text">&ldquo;{seg.text}&rdquo;</span>
                  </span>
                  {seg.output_url ? (
                    <Waveform
                      url={seg.output_url}
                      samples={80}
                      height={20}
                      color="var(--color-blood)"
                      className="vo-seg-wave"
                    />
                  ) : null}
                </button>
                <Popover
                  open={editingVOId === seg.id}
                  onClose={() => setEditingVOId(null)}
                  className="vo-popover"
                >
                  <VOSegmentEditor
                    segment={seg}
                    projectDuration={project.duration_s}
                    job={voJobs[seg.id]}
                    hasKey={!!providerKeys.elevenlabs}
                    onChange={(patch) => updateVOSegment(seg.id, patch)}
                    onGenerate={() => handleGenerateVO(seg.id)}
                    onDismissError={() =>
                      setVoJobs((j) => {
                        const next = { ...j };
                        delete next[seg.id];
                        return next;
                      })
                    }
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
          <div className={`music-bed ${project.music_track?.output_url ? "voiced" : ""}`}>
            <button
              type="button"
              className="music-bed-main"
              onClick={() => setLookOpen("music")}
            >
              <span>
                <strong>{project.music_track?.name ?? "—"}</strong> ·{" "}
                {project.music_track?.model ?? "—"} · v1 · {project.duration_s.toFixed(1)}s · auto-ducks under VO −6dB
              </span>
              <span>{project.music_track?.output_url ? "♪ ✓" : "♪"} ▾</span>
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
          onProviderKeyMissing={() => setProvidersOpen(true)}
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

      {helpOpen ? <HelpDialog onClose={() => setHelpOpen(false)} /> : null}

      <div className="footstrip">
        <span>// AI CINEMA · BUILT FOR THE LOVE OF THE GAME · MIT</span>
        <span className="footstrip-mid">
          {project.sections.length} SECTIONS · {project.vo_segments.length} VO · {projectStubs.length} SAVED · SPENT {formatCost(sessionSpent)}
        </span>
        <span>BLOODY FINGER SOFTWARE — 2026</span>
      </div>

      <ToastViewport />
    </>
  );
}

/* ───────────── PREVIEW STAGE ───────────── */

function PreviewStage({
  project,
  playPosition,
  activeSectionId,
  isPlaying,
  onTogglePlay,
  onStop,
}: {
  project: Project;
  playPosition: number | null;
  activeSectionId: string | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
}) {
  const setActiveSection = useStore((s) => s.setActiveSection);

  const currentIndex = useMemo(() => {
    if (playPosition !== null) return playPosition;
    const i = project.sections.findIndex((s) => s.id === activeSectionId);
    return i >= 0 ? i : 0;
  }, [playPosition, activeSectionId, project.sections]);

  const section = project.sections[currentIndex];
  if (!section) {
    return (
      <div className="preview-stage empty">
        <div className="stage-empty">No sections yet — add a clip or title to begin.</div>
      </div>
    );
  }

  const activeVersion = section.versions.find((v) => v.id === section.active_version_id) ?? null;
  const activeStill = section.stills.find((s) => s.id === section.active_still_id) ?? null;
  const referencedStill =
    activeVersion && activeVersion.kind === "clip" && activeVersion.still_ref
      ? section.stills.find((s) => s.id === activeVersion.still_ref) ?? activeStill
      : activeStill;

  const motionOutput = activeVersion && activeVersion.kind === "clip" ? activeVersion.output_url : undefined;
  const motionVideoUrl =
    motionOutput && /^https?:\/\//.test(motionOutput) ? motionOutput : null;
  const kbDirection =
    motionOutput && motionOutput.startsWith("kenburns:")
      ? (motionOutput.slice("kenburns:".length) as "in" | "out" | "left" | "right")
      : null;
  const stillUrl = referencedStill?.output_url ?? null;

  const startSeconds = project.sections
    .slice(0, currentIndex)
    .reduce((acc, s) => acc + s.duration_s, 0);
  const total = project.duration_s;

  const aspectRatio =
    project.aspect === "16:9" ? "16 / 9" : project.aspect === "1:1" ? "1 / 1" : "9 / 16";

  return (
    <div className="preview-stage">
      <div className="stage-canvas-wrap">
        <div
          className={`stage-canvas aspect-${project.aspect.replace(":", "-")}`}
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
              key={motionVideoUrl}
              src={motionVideoUrl}
              className="stage-video"
              autoPlay={isPlaying}
              muted
              loop
              playsInline
              controls={!isPlaying}
            />
          ) : stillUrl ? (
            <img
              key={`${stillUrl}|${kbDirection}|${section.duration_s}`}
              src={stillUrl}
              alt={section.title}
              className={`stage-img${kbDirection ? ` kb kb-${kbDirection}` : ""}`}
              style={
                kbDirection
                  ? { animationDuration: `${activeVersion && activeVersion.kind === "clip" ? activeVersion.motion.duration_s : section.duration_s}s` }
                  : undefined
              }
            />
          ) : (
            <div className="stage-empty">
              <span>no still generated</span>
              <span className="stage-empty-hint">click section ▾ to open the flow panel</span>
            </div>
          )}
          <div className="stage-hud">
            <span className="stage-idx">{section.index.toString().padStart(2, "0")}</span>
            <span className="stage-title-text">{section.title}</span>
            <span className="stage-type">{section.type.toUpperCase()}</span>
          </div>
        </div>
      </div>
      <div className="stage-controls">
        <button
          type="button"
          className="stage-prev"
          title="Previous section"
          onClick={() => {
            const next = currentIndex <= 0 ? project.sections.length - 1 : currentIndex - 1;
            setActiveSection(project.sections[next].id);
          }}
        >
          ⏮
        </button>
        <button
          type="button"
          className={`stage-play ${isPlaying ? "playing" : ""}`}
          onClick={onTogglePlay}
          title={isPlaying ? "Pause (Space)" : "Play timeline (Space)"}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          className="stage-prev"
          title="Stop"
          onClick={onStop}
          disabled={!isPlaying}
        >
          ◼
        </button>
        <button
          type="button"
          className="stage-prev"
          title="Next section"
          onClick={() => {
            const next = currentIndex >= project.sections.length - 1 ? 0 : currentIndex + 1;
            setActiveSection(project.sections[next].id);
          }}
        >
          ⏭
        </button>
        <div className="stage-timecode">
          <span>{formatTimecode(startSeconds)}</span>
          <span className="stage-divider">/</span>
          <span>{formatTimecode(total)}</span>
          <span className="stage-aspect">{project.aspect.replace(":", " : ")}</span>
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

/* ───────────── TOAST VIEWPORT ───────────── */

function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-viewport" role="region" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast toast-${t.kind}`}
          onClick={() => dismiss(t.id)}
          title="Dismiss"
        >
          <span className="toast-icon">
            {t.kind === "error" ? "✕" : t.kind === "warn" ? "⚠" : t.kind === "success" ? "✓" : "ⓘ"}
          </span>
          <span className="toast-body">
            <span className="toast-msg">{t.message}</span>
            {t.detail ? <span className="toast-detail">{t.detail}</span> : null}
          </span>
        </button>
      ))}
    </div>
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
  onChange: (patch: Partial<{ text: string; voice: string; start_s: number; duration_s: number }>) => void;
  onGenerate: () => void;
  onDismissError: () => void;
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

/* ───────────── FLOW PANEL ───────────── */

function FlowPanel({
  section,
  project,
  providerKeys,
  onOpenProviders,
  onProviderKeyMissing,
}: {
  section: Section;
  project: Project;
  providerKeys: Partial<Record<ProviderId, string>>;
  onOpenProviders: () => void;
  onProviderKeyMissing: () => void;
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

  const setJob = useGenState((s) => s.setJob);
  const clearJob = useGenState((s) => s.clearJob);
  const jobs = useGenState((s) => s.jobs);

  const stillJob = activeStill ? jobs[stillJobKey(section.id, activeStill.id)] : undefined;
  const motionJob =
    activeVersion && activeVersion.kind === "clip"
      ? jobs[motionJobKey(section.id, activeVersion.id)]
      : undefined;

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
      onProviderKeyMissing();
    }
  };

  const COST_CAP = 0.5;

  const handleGenerateStill = async () => {
    if (!activeStill) return;
    const jobKey = stillJobKey(section.id, activeStill.id);
    if (jobs[jobKey]?.status === "running") return;

    const modelId = activeStill.model;
    const composedPrompt = composePromptWithBrief(
      activeStill.image_prompt,
      project.brief?.visual,
    );
    const estCost = imageModelCost(modelId);
    if (estCost > COST_CAP) {
      const ok = confirm(
        `Heads up — this still costs about $${estCost.toFixed(2)} (cap is $${COST_CAP.toFixed(2)}). Generate anyway?`,
      );
      if (!ok) return;
    }

    if (isImageModelFree(modelId)) {
      const url = pollinationsUrl(
        activeStill.image_prompt,
        project.aspect,
        newSeed(),
        project.brief?.visual,
      );
      updateStill(section.id, activeStill.id, { output_url: url });
      return;
    }

    if (!modelHasKey(modelId)) {
      const pid = providerForModel(modelId);
      promptForKey(PROVIDERS.find((p) => p.id === pid)?.name ?? modelId);
      return;
    }

    const pid = providerForModel(modelId);
    if (pid === "replicate" && isReplicateImageModel(modelId)) {
      const token = providerKeys.replicate!;
      setJob(jobKey, { status: "running", startedAt: Date.now() });
      try {
        let referenceImageUrl: string | undefined;
        const refSectionId = parseLastFrameRef(activeStill.input_ref);
        if (refSectionId) {
          const refSection = project.sections.find((s) => s.id === refSectionId);
          const refVersion = refSection?.versions.find(
            (v) => v.id === refSection.active_version_id,
          );
          if (refVersion && refVersion.kind === "clip" && refVersion.output_url) {
            const out = refVersion.output_url;
            if (/^https?:\/\//.test(out)) {
              referenceImageUrl = await extractLastFrameDataUrl(out);
            } else if (out.startsWith("kenburns:")) {
              const stillRef = refVersion.still_ref ?? refSection?.active_still_id ?? null;
              const refStill = stillRef
                ? refSection?.stills.find((st) => st.id === stillRef)
                : undefined;
              referenceImageUrl = refStill?.output_url;
            }
          }
        }
        if (!referenceImageUrl && project.brief?.refs && project.brief.refs.length > 0) {
          referenceImageUrl = project.brief.refs[0];
        }
        if (referenceImageUrl && !imageModelSupportsReference(modelId)) {
          referenceImageUrl = undefined;
        }
        const url = await runReplicateImage({
          model: modelId,
          prompt: composedPrompt,
          aspect: project.aspect,
          apiToken: token,
          referenceImageUrl,
        });
        updateStill(section.id, activeStill.id, { output_url: url });
        clearJob(jobKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setJob(jobKey, { status: "error", error: message });
      }
      return;
    }

    toast.info(
      `Live ${modelId} isn't wired yet`,
      "Switch to Pollinations (free) or Flux / Schnell / SDXL / Ideogram (Replicate).",
    );
  };

  const handleGenerateMotion = async () => {
    if (!activeVersion || activeVersion.kind !== "clip") return;
    const jobKey = motionJobKey(section.id, activeVersion.id);
    if (jobs[jobKey]?.status === "running") return;

    const modelId = activeVersion.motion.model;
    const estMotionCost = motionModelCost(modelId, activeVersion.motion.duration_s);
    if (estMotionCost > COST_CAP) {
      const ok = confirm(
        `Heads up — this motion costs about $${estMotionCost.toFixed(2)} (cap is $${COST_CAP.toFixed(2)}). Generate anyway?`,
      );
      if (!ok) return;
    }

    if (isMotionModelFree(modelId)) {
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
      return;
    }

    if (!modelHasKey(modelId)) {
      const pid = providerForModel(modelId);
      promptForKey(PROVIDERS.find((p) => p.id === pid)?.name ?? modelId);
      return;
    }

    const pid = providerForModel(modelId);
    if (pid === "replicate" && isReplicateMotionModel(modelId)) {
      const stillToUse = referencedStill;
      if (!stillToUse?.output_url) {
        toast.warn(
          "Generate a still first",
          "Motion uses the active still as its first frame.",
        );
        return;
      }
      const token = providerKeys.replicate!;
      const composedPrompt = composePromptWithBrief(
        activeVersion.motion.prompt,
        project.brief?.visual,
      );
      setJob(jobKey, { status: "running", startedAt: Date.now() });
      try {
        const videoUrl = await runReplicateMotion({
          model: modelId,
          prompt: composedPrompt,
          firstFrameUrl: stillToUse.output_url,
          durationSeconds: activeVersion.motion.duration_s || section.duration_s,
          aspect: project.aspect,
          apiToken: token,
        });
        updateClipVersion(section.id, activeVersion.id, {
          output_url: videoUrl,
          still_ref: stillToUse.id,
        });
        clearJob(jobKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setJob(jobKey, { status: "error", error: message });
      }
      return;
    }

    toast.info(
      `Live ${modelId} isn't wired yet`,
      "Switch to Ken Burns (free) or MiniMax Video-01 (Replicate).",
    );
  };

  const dismissStillError = () => {
    if (!activeStill) return;
    clearJob(stillJobKey(section.id, activeStill.id));
  };
  const dismissMotionError = () => {
    if (!activeVersion) return;
    clearJob(motionJobKey(section.id, activeVersion.id));
  };

  const motionOutputUrl =
    activeVersion && activeVersion.kind === "clip" ? activeVersion.output_url : undefined;
  const motionVideoUrl =
    motionOutputUrl && /^https?:\/\//.test(motionOutputUrl) ? motionOutputUrl : null;
  const motionDirection =
    motionOutputUrl && motionOutputUrl.startsWith("kenburns:")
      ? (motionOutputUrl.slice("kenburns:".length) as "in" | "out" | "left" | "right")
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
          motionVideoUrl={motionVideoUrl}
          priorClipSections={priorClipSections}
          modelHasKey={modelHasKey}
          stillJob={stillJob}
          motionJob={motionJob}
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
          onDismissStillError={dismissStillError}
          onDismissMotionError={dismissMotionError}
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
  motionVideoUrl: string | null;
  priorClipSections: Section[];
  modelHasKey: (modelId: string) => boolean;
  stillJob?: GenSlot;
  motionJob?: GenSlot;
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
  onDismissStillError: () => void;
  onDismissMotionError: () => void;
};

function ClipFlowBody({
  section,
  project,
  activeStill,
  activeVersion,
  motionDirection,
  motionStillUrl,
  motionVideoUrl,
  priorClipSections,
  modelHasKey,
  stillJob,
  motionJob,
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
  onDismissStillError,
  onDismissMotionError,
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
        {activeStill ? (
          <div className="ref-hint">
            {(() => {
              const refSectionId = parseLastFrameRef(activeStill.input_ref);
              const briefRef = project.brief?.refs?.[0];
              const supports = imageModelSupportsReference(activeStill.model as never);
              if (refSectionId) {
                const sec = project.sections.find((s) => s.id === refSectionId);
                const label = sec ? `${sec.index.toString().padStart(2, "0")} last frame` : "previous frame";
                return supports
                  ? `→ ${label} feeds into the still as init image (prompt_strength 0.68)`
                  : `→ ${label} captured but ignored; switch to SDXL for init-image continuity`;
              }
              if (briefRef) {
                return supports
                  ? `→ brief reference image used as init (prompt_strength 0.68)`
                  : `→ brief reference image ignored; SDXL accepts an init image`;
              }
              return null;
            })()}
          </div>
        ) : null}

        <div className="preview-row">
          <div
            className={`preview-box${activeStill?.output_url ? " has-image" : ""}${
              stillJob?.status === "running" ? " busy" : ""
            }${stillJob?.status === "error" ? " errored" : ""}`}
          >
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
            {stillJob?.status === "running" ? (
              <div className="gen-overlay">
                <span className="gen-spinner" />
                <span className="gen-label">Generating still…</span>
              </div>
            ) : null}
            {stillJob?.status === "error" ? (
              <div className="gen-overlay error">
                <span className="gen-label">Error: {stillJob.error}</span>
                <button
                  type="button"
                  className="btn ghost gen-dismiss"
                  onClick={onDismissStillError}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
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
            disabled={!activeStill || stillJob?.status === "running"}
            onClick={onGenerateStill}
          >
            {stillJob?.status === "running" ? "● Generating…" : "⏵ Generate still"}
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
          <div
            className={`preview-box motion${motionStillUrl || motionVideoUrl ? " has-image" : ""}${
              motionJob?.status === "running" ? " busy" : ""
            }${motionJob?.status === "error" ? " errored" : ""}`}
          >
            {motionVideoUrl ? (
              <video
                key={motionVideoUrl}
                src={motionVideoUrl}
                className="preview-video"
                autoPlay
                loop
                muted
                playsInline
                controls
              />
            ) : motionStillUrl ? (
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
            {motionJob?.status === "running" ? (
              <div className="gen-overlay">
                <span className="gen-spinner" />
                <span className="gen-label">Generating motion…</span>
              </div>
            ) : null}
            {motionJob?.status === "error" ? (
              <div className="gen-overlay error">
                <span className="gen-label">Error: {motionJob.error}</span>
                <button
                  type="button"
                  className="btn ghost gen-dismiss"
                  onClick={onDismissMotionError}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            {motionVideoUrl ? null : (
              <span className="time">
                0:00 / {(activeVersion?.motion.duration_s ?? section.duration_s).toFixed(1)}
              </span>
            )}
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
            disabled={!activeVersion || motionJob?.status === "running"}
            onClick={onGenerateMotion}
          >
            {motionJob?.status === "running" ? "● Generating…" : "⏵ Generate motion"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── LUT EXPORT ───────────── */

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

  const renderPlan = useMemo(() => describeRenderPlan(project), [project]);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [renderSize, setRenderSize] = useState<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    if (renderUrl) URL.revokeObjectURL(renderUrl);
  }, [renderUrl]);

  const handleRender = async () => {
    if (renderProgress) return;
    setRenderError(null);
    if (renderUrl) URL.revokeObjectURL(renderUrl);
    setRenderUrl(null);
    setRenderSize(0);
    abortRef.current = new AbortController();
    setRenderProgress({ phase: "loading-engine", pct: 0, message: "Starting…" });
    try {
      const result = await renderProject({
        project,
        onProgress: setRenderProgress,
        signal: abortRef.current.signal,
      });
      setRenderUrl(result.url);
      setRenderSize(result.sizeBytes);
      setRenderProgress({ phase: "done", pct: 100, message: "Render complete." });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRenderError(message);
      setRenderProgress(null);
    }
  };

  const handleCancelRender = async () => {
    abortRef.current?.abort();
    await terminateFFmpeg();
    setRenderProgress(null);
    setRenderError("Render cancelled.");
  };

  const handleDownload = () => {
    if (!renderUrl) return;
    const a = document.createElement("a");
    const safe = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "render";
    a.href = renderUrl;
    a.download = `${safe}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const planReady = renderPlan.ready && renderPlan.assets.length > 0;
  const isRunning = renderProgress !== null && renderProgress.phase !== "done";

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

        {renderProgress || renderError || renderUrl ? (
          <div className="modal-section render-status-section">
            <div className="modal-section-title">// RENDER</div>
            {renderError ? (
              <div className="render-error">
                <strong>Render failed.</strong>
                <span>{renderError}</span>
              </div>
            ) : null}
            {renderProgress && !renderError ? (
              <>
                <div className="render-bar">
                  <div className="render-bar-fill" style={{ width: `${renderProgress.pct}%` }} />
                </div>
                <div className="render-progress-row">
                  <span>{renderProgress.phase.replace(/-/g, " ")}</span>
                  <span>{renderProgress.message}</span>
                  <span>{renderProgress.pct}%</span>
                </div>
              </>
            ) : null}
            {renderUrl ? (
              <div className="render-output">
                <video src={renderUrl} controls className="render-video" />
                <div className="render-meta">
                  <span>{(renderSize / (1024 * 1024)).toFixed(2)} MB</span>
                  <button type="button" className="btn primary" onClick={handleDownload}>
                    ⤓ Download MP4
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="modal-foot">
          <span className={`render-status ${planReady ? "ok" : "miss"}`}>
            {planReady
              ? `Plan ready · ${renderPlan.assets.length} segment${renderPlan.assets.length === 1 ? "" : "s"} · ${renderPlan.totalDuration.toFixed(1)}s`
              : renderPlan.issues.length > 0
                ? `${renderPlan.issues.length} section${renderPlan.issues.length === 1 ? "" : "s"} not renderable yet`
                : "No assets to render"}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            {isRunning ? (
              <button type="button" className="btn ghost" onClick={handleCancelRender}>
                ■ Cancel render
              </button>
            ) : (
              <button type="button" className="btn ghost" onClick={onClose}>Close</button>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={!planReady || isRunning}
              onClick={handleRender}
              title={
                planReady
                  ? "Concatenate active assets with ffmpeg.wasm and produce an MP4"
                  : renderPlan.issues.map((i) => `${i.title}: ${i.reason}`).join(" · ")
              }
            >
              {isRunning
                ? "● Rendering…"
                : renderUrl
                  ? "↻ Re-render"
                  : "▶︎ Render MP4"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── HELP DIALOG ───────────── */

function HelpDialog({ onClose }: { onClose: () => void }) {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || "");
  const mod = isMac ? "⌘" : "Ctrl";
  const groups: { title: string; items: { keys: string[]; label: string }[] }[] = [
    {
      title: "// EDITING",
      items: [
        { keys: [`${mod} Z`], label: "Undo" },
        { keys: [`⇧ ${mod} Z`, `${mod} Y`], label: "Redo" },
        { keys: [`${mod} S`], label: "Save snapshot to library" },
        { keys: ["D"], label: "Duplicate active section" },
        { keys: ["Del", "⌫"], label: "Remove active section" },
      ],
    },
    {
      title: "// NAVIGATION",
      items: [
        { keys: ["←"], label: "Previous section" },
        { keys: ["→"], label: "Next section" },
        { keys: ["Esc"], label: "Close panel / dialog" },
      ],
    },
    {
      title: "// PLAYBACK",
      items: [
        { keys: ["Space"], label: "Preview / stop timeline" },
      ],
    },
    {
      title: "// HELP",
      items: [
        { keys: ["?", "/"], label: "Open this dialog" },
      ],
    },
  ];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">// SHORTCUTS</div>
            <div className="modal-sub">Keys are ignored while typing in inputs</div>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>✕ Close</button>
        </div>
        <div className="modal-body">
          {groups.map((g) => (
            <div key={g.title} className="modal-section">
              <div className="modal-section-title">{g.title}</div>
              <div className="shortcut-grid">
                {g.items.map((item) => (
                  <div key={item.label} className="shortcut-row">
                    <div className="shortcut-keys">
                      {item.keys.map((k, i) => (
                        <span key={i} className="kbd">{k}</span>
                      ))}
                    </div>
                    <div className="shortcut-label">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <span className="render-status">Bring your own model · cinematic by default</span>
          <button type="button" className="btn primary" onClick={onClose}>OK</button>
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

  const malformedHint =
    draft.trim() && keyPrefix && !draft.trim().startsWith(keyPrefix)
      ? `Doesn't start with ${keyPrefix} — double-check before saving`
      : null;
  const commit = () => {
    if (!draft.trim()) return;
    if (malformedHint && !confirm(`${malformedHint}. Save anyway?`)) return;
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
      {malformedHint && editing ? <div className="provider-warn">⚠ {malformedHint}</div> : null}
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
