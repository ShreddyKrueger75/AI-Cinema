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
import { confirmAsk, useConfirm } from "@/lib/confirm";
import { useWaveform } from "@/lib/waveform";
import { signOut, useSession } from "next-auth/react";
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
import { isRunwayMotionModel, runRunwayMotion } from "@/lib/runway";
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

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

function templateIcon(id: string): string {
  switch (id) {
    case "tpl_blank": return "◯";
    case "tpl_product_reveal": return "◉";
    case "tpl_title_card": return "T";
    case "tpl_tutorial_3shot": return "⌗";
    case "tpl_dark_drop": return "◖";
    default: return "▪";
  }
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
  const updateStill = useStore((s) => s.updateStill);
  const updateClipVersion = useStore((s) => s.updateClipVersion);

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

  const projectOrder = useProjectLibrary((s) => s.order);
  const savedProjectsMap = useProjectLibrary((s) => s.projects);
  const projectStubs = useMemo(
    () => projectOrder.map((id) => savedProjectsMap[id]).filter(Boolean),
    [projectOrder, savedProjectsMap],
  );
  const savedSnapshot = savedProjectsMap[project.id];
  const isDirty = !savedSnapshot || savedSnapshot.updated_at !== project.updated_at;
  const isInLibrary = !!savedSnapshot;

  const configuredKeyCountEarly = Object.values(providerKeys).filter((v) => v && v.trim()).length;

  const [welcomeDismissed, setWelcomeDismissed] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem("ai-cinema:welcome-dismissed") !== "1") {
        setWelcomeDismissed(false);
      }
    } catch {
      // storage disabled — keep dismissed
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
  const [renderOpen, setRenderOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [playPosition, setPlayPosition] = useState<number | null>(null);
  const [playheadSeconds, setPlayheadSeconds] = useState<number>(0);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playRAFRef = useRef<number | null>(null);
  const playStartedAtRef = useRef<number>(0);

  const stopPreview = useCallback(() => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    if (playRAFRef.current !== null) cancelAnimationFrame(playRAFRef.current);
    playTimerRef.current = null;
    playRAFRef.current = null;
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
    if (playRAFRef.current !== null) cancelAnimationFrame(playRAFRef.current);
  }, []);

  const startPreview = useCallback(() => {
    if (project.sections.length === 0) return;
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    if (playRAFRef.current !== null) cancelAnimationFrame(playRAFRef.current);
    playStartedAtRef.current = performance.now();
    setPlayheadSeconds(0);
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
    const total = project.sections.reduce((a, s) => a + s.duration_s, 0);
    const tick = () => {
      const elapsed = (performance.now() - playStartedAtRef.current) / 1000;
      if (elapsed >= total) {
        setPlayheadSeconds(0);
        playRAFRef.current = null;
        return;
      }
      setPlayheadSeconds(elapsed);
      playRAFRef.current = requestAnimationFrame(tick);
    };
    playRAFRef.current = requestAnimationFrame(tick);
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
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      // Esc fires before the editable bail so it dismisses dialogs even when an
      // input inside the dialog has focus.
      if (e.key === "Escape") {
        if (useConfirm.getState().prompt) { useConfirm.getState().cancel(); return; }
        if (paletteOpen) { setPaletteOpen(false); return; }
        if (helpOpen) { setHelpOpen(false); return; }
        if (renderOpen) { setRenderOpen(false); return; }
        if (providersOpen) { setProvidersOpen(false); return; }
        if (lookOpen) { setLookOpen(null); return; }
        if (!editable && activeSectionId) { setActiveSection(null); return; }
        return;
      }
      if (editable) return;

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setHelpOpen((o) => !o);
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
    confirmAsk({
      title: "Reset project?",
      message: "This wipes the current timeline back to the Product Reveal seed. Anything not saved to the project library will be lost.",
      confirm_label: "↺ Reset",
      cancel_label: "Keep editing",
      destructive: true,
      onConfirm: () => {
        resetProject();
        toast.info("Project reset", "Back to the Product Reveal seed.");
      },
    });
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
  const tlGridCols = project.sections.length > 0
    ? project.sections.map((s) => `${Math.max(0.1, s.duration_s)}fr`).join(" ")
    : "1fr";
  const aspectClass = `aspect-${project.aspect.replace(":", "-")}`;

  const handleExport = () => {
    downloadProjectJSON(project);
    const safe = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
    toast.success("Project exported", `${safe}.ai-cinema.json`);
  };
  const handleImport = async () => {
    const result = await pickProjectJSONFile();
    if (result.ok) {
      setProject(result.project);
      toast.success("Project imported", `${result.project.name} · ${result.project.sections.length} sections`);
    } else {
      toast.error("Import failed", result.error);
    }
  };

  return (
    <>
      <div className="workspace">
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
              ? "FREE PREVIEW · POLLINATIONS QUEUED · ADD KEY FOR RELIABILITY"
              : `PROVIDERS // ${configuredKeyCount} KEY${configuredKeyCount === 1 ? "" : "S"}`}
          </button>
        </div>
        <div className="right">
          <span>{hydrated ? "STATE // PERSISTED" : "STATE // EPHEMERAL"}</span>
          <UserStatusChip />
        </div>
      </div>

      <div className="hero">
        <span className="hero-brand">Cinema <span className="ai">AI</span></span>
        <button
          type="button"
          className="cta-hero"
          onClick={() => setTemplatesOpen(true)}
          title="Pick a template to start fast"
          aria-label="Open templates to start a new project"
        >
          Let&apos;s Go!
        </button>
      </div>

      {showWelcome ? (
        <div className="welcome-banner">
          <div className="welcome-body">
            <strong>Welcome to AI Cinema.</strong>
            <span>
              Free preview: Pollinations stills (now rate-limited — 1 queued request per IP, retries until they let you through) +
              Ken Burns motion on top. Title cards + ffmpeg.wasm render still work fully without a key.
            </span>
            <span>
              For reliable generation, add a Replicate key via 🔑 Keys to unlock Flux, MiniMax video, and the rest, or sign up at
              enter.pollinations.ai for a Pollinations token. Try a
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
                    ? "Edited since last library snapshot — ⌘S to save again"
                    : "In sync with the library snapshot"
                }
              >
                {isDirty ? "● EDITED" : "✓ SAVED"}
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
            <span>{clipsCount} section{clipsCount === 1 ? "" : "s"}</span>
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
                          aria-label={`Delete ${p.name} from library`}
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
            aria-label="Undo (⌘Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={handleRedo}
            disabled={historyFutureLen === 0}
            title="Redo (⇧⌘Z)"
            aria-label="Redo (⇧⌘Z)"
          >
            ↷
          </button>
          <button type="button" className="btn ghost" onClick={handleReset} title="Reset to defaults">↺ Reset</button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts (?)"
          >
            ?
          </button>
          <button type="button" className="btn ghost" onClick={handleImport} title="Import a project JSON" aria-label="Import project JSON">⇧ Import</button>
          <button type="button" className="btn ghost" onClick={handleExport} title="Export the project as JSON" aria-label="Export project JSON">⇩ Export</button>
          <button
            type="button"
            className={`btn ${playPosition !== null ? "primary" : ""}`}
            onClick={togglePreview}
            title="Walk through each section for its duration (Space)"
            aria-label={playPosition !== null ? "Stop preview playback" : "Play preview playback"}
          >
            {playPosition !== null ? "■ Stop" : "▶ Preview"}
          </button>
          <button type="button" className="btn primary" onClick={() => setRenderOpen(true)} aria-label="Open Render to MP4 dialog">⤓ Render MP4</button>
        </div>
      </div>

      <div className="project-settings">
        <div className="project-settings-title">// PROJECT SETTINGS</div>
        <div className="stage-meta-aspect" role="radiogroup" aria-label="Aspect ratio">
          {ASPECT_OPTIONS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={project.aspect === a}
              className={`aspect-pill ${project.aspect === a ? "active" : ""} aspect-${a.replace(":", "-")}`}
              onClick={() => updateProjectMeta({ aspect: a })}
              title={`Set whole video to ${a}`}
            >
              <span className={`aspect-glyph glyph-${a.replace(":", "-")}`} aria-hidden />
              <span className="aspect-label">{a}</span>
            </button>
          ))}
        </div>
        <div className="lookbar">
        <LookSlot
          label="// BRIEF"
          icon="✎"
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
          icon="◐"
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
          icon="♫"
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
          icon="T"
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
          <span>
            Click a clip · ◇ for transitions · Space play · click ruler to seek
          </span>
        </div>
        {playPosition !== null ? (
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

        <div
          className="clips-row"
          style={{ gridTemplateColumns: tlGridCols }}
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
                onClickCapture={() => setActiveSection(section.id)}
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
                    {section.index.toString().padStart(2, "0")} // {section.type.toUpperCase()}
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
                  const v = section.versions.find((x) => x.id === section.active_version_id);
                  const stillRef = v && v.kind === "clip" ? v.still_ref ?? section.active_still_id : section.active_still_id;
                  const still = stillRef ? section.stills.find((s) => s.id === stillRef) : null;
                  const thumb = still?.output_url;
                  const isVideo = v && v.kind === "clip" && v.output_url && /^https?:\/\//.test(v.output_url);
                  if (section.type === "title") {
                    return (
                      <div
                        className={`clip-thumb title ${aspectClass}`}
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

        <div className="audio-row vo-row" style={{ marginTop: 14 }}>
          <div className="track-label">VO</div>
          <VOTrack
            segments={project.vo_segments}
            duration={project.duration_s}
            editingVOId={editingVOId}
            setEditingVOId={setEditingVOId}
            voJobs={voJobs}
            providerKeys={providerKeys}
            updateVOSegment={updateVOSegment}
            handleGenerateVO={handleGenerateVO}
            setVoJobs={setVoJobs}
            removeVOSegment={removeVOSegment}
            addVOSegment={addVOSegment}
          />
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
        <div className="flow-modal-overlay" onClick={() => setActiveSection(null)}>
          <div className="flow-modal" onClick={(e) => e.stopPropagation()}>
            <FlowPanel
              section={activeSection}
              project={project}
              providerKeys={providerKeys}
              onOpenProviders={() => setProvidersOpen(true)}
              onProviderKeyMissing={() => setProvidersOpen(true)}
            />
          </div>
        </div>
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

      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          actions={[
            {
              id: "new-clip",
              label: "New clip section",
              keywords: "add insert clip",
              run: () => { addClipSection(null); toast.info("Added clip"); },
            },
            {
              id: "new-title",
              label: "New title card",
              keywords: "add insert title card",
              run: () => { addTitleSection(null); toast.info("Added title"); },
            },
            {
              id: "save",
              label: "Save snapshot to library",
              keywords: "save snapshot library s",
              run: () => { saveProjectToLibrary(project); toast.success("Saved to library", project.name); },
            },
            {
              id: "export",
              label: "Export project JSON",
              keywords: "export json download",
              run: handleExport,
            },
            {
              id: "import",
              label: "Import project JSON",
              keywords: "import upload",
              run: handleImport,
            },
            {
              id: "render",
              label: "Open Render dialog",
              keywords: "render mp4 ffmpeg",
              run: () => setRenderOpen(true),
            },
            {
              id: "providers",
              label: "Manage provider keys",
              keywords: "keys providers replicate elevenlabs runway api",
              run: () => setProvidersOpen(true),
            },
            {
              id: "templates",
              label: "Browse project templates",
              keywords: "templates starter blank product reveal",
              run: () => setTemplatesOpen(true),
            },
            {
              id: "projects",
              label: "Open project library",
              keywords: "projects library switch open",
              run: () => setProjectsOpen(true),
            },
            {
              id: "reset",
              label: "Reset to default project",
              keywords: "reset wipe new",
              run: handleReset,
            },
            {
              id: "lut",
              label: "Export grade as .cube LUT",
              keywords: "lut grade export color",
              run: handleExportLUT,
            },
            {
              id: "play",
              label: playPosition !== null ? "Stop preview" : "Play preview",
              keywords: "play preview pause stop space",
              run: () => (playPosition !== null ? stopPreview() : startPreview()),
            },
            {
              id: "help",
              label: "Show keyboard shortcuts",
              keywords: "help shortcuts keys ?",
              run: () => setHelpOpen(true),
            },
            ...project.sections.map((s) => ({
              id: `goto-${s.id}`,
              label: `Go to section ${s.index.toString().padStart(2, "0")} — ${s.title}`,
              keywords: `section ${s.title} ${s.type}`,
              run: () => setActiveSection(s.id),
            })),
          ]}
        />
      ) : null}

      <aside className="workspace-library">
        <div className="lib-tabs">
          <button type="button" className="lib-tab active"><span className="lib-tab-icon" aria-hidden>⊞</span> // PROJECTS</button>
          <button type="button" className="lib-tab" onClick={() => setTemplatesOpen(true)}><span className="lib-tab-icon" aria-hidden>⚀</span> // TEMPLATES</button>
        </div>
        <div className="lib-body">
          <button
            type="button"
            className="lib-save"
            onClick={() => {
              saveProjectToLibrary(project);
              toast.success("Saved to library", project.name);
            }}
            title="Save snapshot (⌘S)"
          >
            <span className="lib-tab-icon" aria-hidden>⊞</span> Save current as snapshot
          </button>
          <div className="lib-section-title"><span className="lib-section-icon" aria-hidden>●</span> // SAVED</div>
          {projectStubs.length === 0 ? (
            <div className="lib-empty">no saved projects yet</div>
          ) : (
            <div className="lib-list">
              {projectStubs.map((p) => {
                const isOpen = p.id === project.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`lib-row ${isOpen ? "active" : ""}`}
                    aria-label={
                      isOpen
                        ? `${p.name} — currently loaded`
                        : `Load ${p.name} snapshot — replaces current project`
                    }
                    title={
                      isOpen
                        ? "Currently loaded — edits flow into the live project"
                        : "Click to load this snapshot · current project is auto-saved first"
                    }
                    onClick={() => {
                      if (isOpen) {
                        toast.info(`${p.name} is already loaded`);
                        return;
                      }
                      if (isInLibrary) saveProjectToLibrary(project);
                      const loaded = loadProjectFromLibrary(p.id);
                      if (loaded) {
                        setProject(loaded);
                        toast.success("Loaded snapshot", `${p.name} · ${p.sections.length} sections`);
                      } else {
                        toast.error("Load failed", "Snapshot not found in library");
                      }
                    }}
                  >
                    <span className="lib-row-name">
                      {isOpen ? "● " : ""}{p.name}
                      {!isOpen ? <span className="lib-row-action">↻ Load</span> : null}
                    </span>
                    <span className="lib-row-meta">
                      {p.aspect.replace(":", " : ")} · {p.duration_s.toFixed(1)}s · {p.sections.length} sec
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="lib-section-title"><span className="lib-section-icon" aria-hidden>⚀</span> // TEMPLATES</div>
          <div className="lib-list">
            {TEMPLATES.slice(0, 5).map((t) => (
              <button
                key={t.id}
                type="button"
                className="lib-row"
                onClick={() => {
                  confirmAsk({
                    title: `Load ${t.name}?`,
                    message: "This replaces your current timeline with the template.",
                    confirm_label: "Load template",
                    cancel_label: "Keep editing",
                    destructive: true,
                    onConfirm: () => setProject(t.build()),
                  });
                }}
              >
                <span className="lib-row-name">
                  <span className="lib-row-icon" aria-hidden>{templateIcon(t.id)}</span>
                  {t.name}
                </span>
                <span className="lib-row-meta">{t.description}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="footstrip">
        <span>// AI CINEMA · BUILT FOR THE LOVE OF THE GAME · MIT</span>
        <span className="footstrip-mid">
          {project.sections.length} SECTIONS · {project.vo_segments.length} VO · {projectStubs.length} SAVED · SPENT {formatCost(sessionSpent)}
        </span>
        <span>BLOODY FINGER SOFTWARE — 2026</span>
      </div>
      </div>

      <ToastViewport />
      <ConfirmViewport />
    </>
  );
}

/* ───────────── VO TRACK ───────────── */

type VOSeg = {
  id: string;
  text: string;
  voice: string;
  start_s: number;
  duration_s: number;
  output_url?: string;
};

function VOTrack({
  segments,
  duration,
  editingVOId,
  setEditingVOId,
  voJobs,
  providerKeys,
  updateVOSegment,
  handleGenerateVO,
  setVoJobs,
  removeVOSegment,
  addVOSegment,
}: {
  segments: VOSeg[];
  duration: number;
  editingVOId: string | null;
  setEditingVOId: (id: string | null) => void;
  voJobs: Record<string, { status: "running" | "error"; error?: string }>;
  providerKeys: Partial<Record<ProviderId, string>>;
  updateVOSegment: (id: string, patch: Partial<Omit<VOSeg, "id">>) => void;
  handleGenerateVO: (id: string) => void;
  setVoJobs: React.Dispatch<
    React.SetStateAction<Record<string, { status: "running" | "error"; error?: string }>>
  >;
  removeVOSegment: (id: string) => void;
  addVOSegment: () => void;
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
            {editingVOId === seg.id ? (
              <div className="vo-pop-wrap">
                <Popover
                  open
                  onClose={() => setEditingVOId(null)}
                  className="vo-popover"
                >
                  <VOSegmentEditor
                    segment={seg}
                    projectDuration={duration}
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
              </div>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        className="vo-add-btn"
        onClick={addVOSegment}
        title="Add VO segment"
      >
        + VO
      </button>
    </div>
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
  const updateProjectMeta = useStore((s) => s.updateProjectMeta);

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

  const handleSeekToSection = (idx: number) => {
    const next = ((idx % project.sections.length) + project.sections.length) % project.sections.length;
    setActiveSection(project.sections[next].id);
  };

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
              key={motionVideoUrl}
              src={motionVideoUrl}
              className="stage-video"
              autoPlay={isPlaying}
              muted
              loop
              playsInline
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
              <span className="stage-empty-hint">click a section in the timeline · open its flow panel to generate</span>
            </div>
          )}

          <div className="stage-hud">
            <span className="stage-idx">{section.index.toString().padStart(2, "0")}</span>
            <span className="stage-title-text">{section.title}</span>
            <span className="stage-type">{section.type.toUpperCase()}</span>
          </div>

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

          {/* Bottom overlay control bar */}
          <div className="stage-chrome" onClick={(e) => e.stopPropagation()}>
            <div className="stage-scrubber" role="presentation">
              {project.sections.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={`stage-scrub-seg ${i === currentIndex ? "active" : ""} ${i < currentIndex ? "past" : ""}`}
                  style={{ flex: Math.max(0.1, s.duration_s) }}
                  onClick={() => setActiveSection(s.id)}
                  title={`Jump to ${s.index.toString().padStart(2, "0")} ${s.title} · ${formatTimecode(project.sections.slice(0, i).reduce((a, x) => a + x.duration_s, 0))}`}
                  aria-label={`Jump to section ${s.index} ${s.title}`}
                />
              ))}
            </div>
            <div className="stage-chrome-row">
              <div className="stage-chrome-left">
                <button
                  type="button"
                  className="stage-iconbtn"
                  title="Previous section"
                  aria-label="Previous section"
                  onClick={() => handleSeekToSection(currentIndex - 1)}
                >
                  ⏮
                </button>
                <button
                  type="button"
                  className="stage-iconbtn primary"
                  title={isPlaying ? "Pause (Space)" : "Play (Space)"}
                  aria-label={isPlaying ? "Pause preview" : "Play preview"}
                  onClick={onTogglePlay}
                >
                  {isPlaying ? "❚❚" : "▶"}
                </button>
                <button
                  type="button"
                  className="stage-iconbtn"
                  title="Next section"
                  aria-label="Next section"
                  onClick={() => handleSeekToSection(currentIndex + 1)}
                >
                  ⏭
                </button>
                {isPlaying ? (
                  <button
                    type="button"
                    className="stage-iconbtn"
                    title="Stop"
                    aria-label="Stop preview"
                    onClick={onStop}
                  >
                    ◼
                  </button>
                ) : null}
                <span className="stage-chrome-time">
                  {formatTimecode(startSeconds)}
                  <span className="stage-divider">/</span>
                  {formatTimecode(total)}
                </span>
              </div>
              <div className="stage-chrome-right">
                <button
                  type="button"
                  className="stage-iconbtn"
                  title="Fullscreen"
                  aria-label="Toggle fullscreen"
                  onClick={(e) => {
                    const canvas = (e.currentTarget.closest(".stage-canvas") as HTMLElement) ?? null;
                    if (!canvas) return;
                    if (document.fullscreenElement) {
                      document.exitFullscreen().catch((err) => {
                        toast.warn("Couldn't exit fullscreen", err?.message ?? String(err));
                      });
                      return;
                    }
                    const req = canvas.requestFullscreen?.bind(canvas);
                    if (!req) {
                      toast.warn("Fullscreen unsupported", "This browser doesn't expose requestFullscreen on the preview canvas.");
                      return;
                    }
                    req().catch((err: unknown) => {
                      const msg = err instanceof Error ? err.message : String(err);
                      toast.warn("Fullscreen blocked", msg);
                    });
                  }}
                >
                  ⛶
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="stage-meta">
        <div className="stage-meta-info">
          <span>{section.index.toString().padStart(2, "0")} / {project.sections.length}</span>
          <span className="stage-divider">·</span>
          <span>{section.title}</span>
          <span className="stage-divider">·</span>
          <span>{section.duration_s.toFixed(1)}s</span>
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

function ConfirmViewport() {
  const prompt = useConfirm((s) => s.prompt);
  const resolve = useConfirm((s) => s.resolve);
  const cancel = useConfirm((s) => s.cancel);
  if (!prompt) return null;
  const titleId = `confirm-title-${prompt.id}`;
  const messageId = `confirm-message-${prompt.id}`;
  return (
    <div
      className="modal-overlay"
      onClick={cancel}
      role="alertdialog"
      aria-modal
      aria-labelledby={titleId}
      aria-describedby={messageId}
    >
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title" id={titleId}>{prompt.title}</div>
        <div className="confirm-message" id={messageId}>{prompt.message}</div>
        <div className="confirm-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={cancel}
            autoFocus={prompt.destructive}
          >
            {prompt.cancel_label}
          </button>
          <button
            type="button"
            className={`btn ${prompt.destructive ? "danger" : "primary"}`}
            onClick={() => { resolve(); }}
            autoFocus={!prompt.destructive}
          >
            {prompt.confirm_label}
          </button>
        </div>
      </div>
    </div>
  );
}

function UserStatusChip() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  if (status === "loading") return <span>SESSION // …</span>;
  if (!session?.user) {
    return (
      <a href="/login" className="status-link">SIGN IN</a>
    );
  }
  const email = session.user.email ?? session.user.name ?? "";
  const initial = (session.user.name ?? email).slice(0, 1).toUpperCase();
  return (
    <span className="popover-anchor">
      <button
        type="button"
        className="user-chip"
        onClick={() => setOpen((o) => !o)}
        title="Account"
      >
        <span className="user-avatar">{initial}</span>
        <span className="user-email">{email}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="menu" align="right">
        <div className="user-menu-head">
          <strong>{session.user.name ?? email}</strong>
          {session.user.name ? <span>{email}</span> : null}
        </div>
        <button
          type="button"
          className="menu-item"
          onClick={async () => {
            setOpen(false);
            await signOut({ redirect: false });
          }}
        >
          Sign out
        </button>
      </Popover>
    </span>
  );
}

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
  onChange: (patch: Partial<{ text: string; voice: string; start_s: number; duration_s: number; output_url: string }>) => void;
  onGenerate: () => void;
  onDismissError: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="editor compact">
      <div className="editor-head">
        <span>// VO</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="btn ghost"
            title="Import an audio file instead of generating"
            onClick={async () => {
              const file = await pickFile("audio/*");
              if (!file) return;
              const url = URL.createObjectURL(file);
              onChange({ output_url: url });
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
      const jobKey = stillJobKey(section.id, activeStill.id);
      setJob(jobKey, { status: "running", startedAt: Date.now() });
      let throttled = false;
      try {
        const r = await fetch(url, { credentials: "omit" });
        if (!r.ok) {
          let detail = `HTTP ${r.status}`;
          try {
            const body = await r.text();
            const json = JSON.parse(body);
            if (json?.error) detail = json.error;
          } catch {
            // not JSON; keep status code
          }
          if (r.status === 402 || /queue/i.test(detail)) {
            throttled = true;
            throw new Error(
              `Pollinations free queue is full — ${detail}.`,
            );
          }
          throw new Error(`Pollinations ${r.status}: ${detail}`);
        }
        const blob = await r.blob();
        const blobUrl = URL.createObjectURL(blob);
        updateStill(section.id, activeStill.id, { output_url: blobUrl });
        clearJob(jobKey);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const replicateToken = providerKeys.replicate;
        if (throttled && replicateToken) {
          toast.info("Pollinations queued", "Falling back to Flux Schnell · ~$0.003");
          try {
            const fallbackUrl = await runReplicateImage({
              model: "flux-schnell",
              prompt: composedPrompt,
              aspect: project.aspect,
              apiToken: replicateToken,
            });
            updateStill(section.id, activeStill.id, { output_url: fallbackUrl });
            clearJob(jobKey);
            toast.success("Fallback succeeded", "Generated on Flux Schnell · switch the still's model to make it stick");
            return;
          } catch (fallbackErr) {
            const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            setJob(jobKey, { status: "error", error: fbMsg });
            toast.error("Flux Schnell fallback failed", fbMsg);
            return;
          }
        }
        setJob(jobKey, { status: "error", error: message });
        toast.error(
          throttled ? "Free preview throttled" : "Generation failed",
          throttled
            ? `${message} Wait ~30s, sign up at https://enter.pollinations.ai, or add a Replicate key for automatic Flux Schnell fallback.`
            : message,
        );
      }
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

    if (pid === "runway" && isRunwayMotionModel(modelId)) {
      const stillToUse = referencedStill;
      if (!stillToUse?.output_url) {
        toast.warn(
          "Generate a still first",
          "Motion uses the active still as its first frame.",
        );
        return;
      }
      if (
        stillToUse.output_url.startsWith("blob:") ||
        stillToUse.output_url.startsWith("data:")
      ) {
        toast.warn(
          "Runway needs an internet-reachable still",
          "The current still is a browser-local blob (e.g. from Pollinations). Use a still generated by a Replicate model (Flux / SDXL) so its URL is on a public CDN, or re-host the still first.",
        );
        return;
      }
      const token = providerKeys.runway!;
      const composedPrompt = composePromptWithBrief(
        activeVersion.motion.prompt,
        project.brief?.visual,
      );
      setJob(jobKey, { status: "running", startedAt: Date.now() });
      try {
        const videoUrl = await runRunwayMotion({
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
      "Switch to Ken Burns (free), MiniMax Video-01 (Replicate), or a Runway Gen-3/Gen-4 model.",
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

      <div className="flow-notes">
        <span className="flow-notes-label">💬 Director&apos;s note</span>
        <textarea
          className="flow-notes-input"
          rows={2}
          placeholder={
            section.type === "title"
              ? "Why this card? Beat, transition, payoff…"
              : "Continuity cues, blocking, the joke…"
          }
          value={section.notes ?? ""}
          onChange={(e) => updateSection(section.id, { notes: e.target.value })}
        />
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
          onOpenProviders={onOpenProviders}
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
        <div className="stage-title"><span className="num">01</span><span className="stage-title-icon" aria-hidden>T</span>TITLE CARD</div>
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
                      aria-label={`Remove version ${v.label}`}
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
  onOpenProviders: () => void;
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
  onOpenProviders,
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
  const stillProviderName = activeStill
    ? PROVIDERS.find((p) => p.id === providerForModel(activeStill.model))?.name ?? null
    : null;
  const motionProviderName = activeVersion
    ? PROVIDERS.find((p) => p.id === providerForModel(activeVersion.motion.model))?.name ?? null
    : null;

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
        <div className="stage-title"><span className="num">01</span><span className="stage-title-icon" aria-hidden>▣</span>STILL</div>

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
        {activeStill ? (() => {
          const refSectionId = parseLastFrameRef(activeStill.input_ref);
          const briefRef = project.brief?.refs?.[0];
          const supports = imageModelSupportsReference(activeStill.model as never);
          let text: string | null = null;
          if (refSectionId) {
            const sec = project.sections.find((s) => s.id === refSectionId);
            const label = sec ? `${sec.index.toString().padStart(2, "0")} last frame` : "previous frame";
            text = supports
              ? `→ ${label} feeds into the still as init image (prompt_strength 0.68)`
              : `→ ${label} captured but ignored; switch to SDXL for init-image continuity`;
          } else if (briefRef) {
            text = supports
              ? `→ brief reference image used as init (prompt_strength 0.68)`
              : `→ brief reference image ignored; SDXL accepts an init image`;
          }
          if (!text) return null;
          if (supports) return <div className="ref-hint">{text}</div>;
          return (
            <button
              type="button"
              className="ref-hint"
              title="Switch model to SDXL so the reference image is used as an init image"
              aria-label="Switch model to SDXL to use reference image"
              onClick={() => {
                onUpdateStill(activeStill.id, { model: "sdxl" });
                toast.success("Model switched", "SDXL accepts init images · regenerate to apply");
              }}
            >
              {text}
            </button>
          );
        })() : null}

        <div className="preview-row">
          <div
            className={`preview-box aspect-${project.aspect.replace(":", "-")}${
              activeStill?.output_url ? " has-image" : ""
            }${stillJob?.status === "running" ? " busy" : ""}${
              stillJob?.status === "error" ? " errored" : ""
            }`}
          >
            {activeStill?.output_url ? (
              <img
                key={activeStill.output_url}
                src={activeStill.output_url}
                alt={activeStill.label}
                className="preview-img"
                onError={() =>
                  toast.error(
                    "Image didn't load",
                    "The upstream returned an error before any bytes arrived. Free Pollinations is queued — try again, sign up at enter.pollinations.ai, or add a Replicate key.",
                  )
                }
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
                        aria-label={`Remove still ${still.label}`}
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
          {stillNeedsKey ? (
            <button
              type="button"
              className="gen-cost warn gen-cost-link"
              onClick={onOpenProviders}
              title={`Open Providers to add a ${stillProviderName ?? "provider"} key`}
              aria-label={`Open Providers to add a ${stillProviderName ?? "provider"} key`}
            >
              ⊘ Needs {stillProviderName ?? "API"} key →
            </button>
          ) : (
            <span className="gen-cost">{formatCost(stillCost)} per still</span>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={stillJob?.status === "running"}
            onClick={
              stillJob?.status === "running"
                ? undefined
                : !activeStill
                  ? onAddStill
                  : stillNeedsKey
                    ? onOpenProviders
                    : onGenerateStill
            }
            title={
              !activeStill
                ? "Add a still to start"
                : stillNeedsKey
                  ? `Open Providers to add a ${stillProviderName ?? "provider"} key`
                  : undefined
            }
            aria-label={
              !activeStill
                ? "Add a new still"
                : stillNeedsKey
                  ? `Open Providers to add a ${stillProviderName ?? "provider"} key`
                  : "Generate still"
            }
          >
            {stillJob?.status === "running"
              ? "● Generating…"
              : !activeStill
                ? "+ Add still first"
                : stillNeedsKey
                  ? `🔑 Add ${stillProviderName ?? "provider"} key`
                : "✦ Generate still"}
          </button>
        </div>
      </div>

      {/* STAGE 2 — MOTION */}
      <div className="stage">
        <div className="stage-title"><span className="num">02</span><span className="stage-title-icon" aria-hidden>◐</span>MOTION</div>

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
            className={`preview-box motion aspect-${project.aspect.replace(":", "-")}${
              motionStillUrl || motionVideoUrl ? " has-image" : ""
            }${motionJob?.status === "running" ? " busy" : ""}${
              motionJob?.status === "error" ? " errored" : ""
            }`}
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
                        aria-label={`Remove version ${v.label}`}
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
          {motionNeedsKey ? (
            <button
              type="button"
              className="gen-cost warn gen-cost-link"
              onClick={onOpenProviders}
              title={`Open Providers to add a ${motionProviderName ?? "provider"} key`}
              aria-label={`Open Providers to add a ${motionProviderName ?? "provider"} key`}
            >
              ⊘ Needs {motionProviderName ?? "API"} key →
            </button>
          ) : (
            <span className="gen-cost">{formatCost(motionCost)} per version</span>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={!activeVersion || motionJob?.status === "running"}
            onClick={motionNeedsKey ? onOpenProviders : onGenerateMotion}
            title={
              motionNeedsKey
                ? `Open Providers to add a ${motionProviderName ?? "provider"} key`
                : undefined
            }
          >
            {motionJob?.status === "running"
              ? "● Generating…"
              : motionNeedsKey
                ? `🔑 Add ${motionProviderName ?? "provider"} key`
                : "✦ Generate motion"}
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
                ? (() => {
                    const counts = new Map<string, number>();
                    for (const i of renderPlan.issues) {
                      counts.set(i.reason, (counts.get(i.reason) ?? 0) + 1);
                    }
                    const parts = Array.from(counts.entries()).map(
                      ([reason, n]) => `${n} ${reason}`,
                    );
                    return `${renderPlan.issues.length} section${renderPlan.issues.length === 1 ? "" : "s"} not renderable yet — ${parts.join(" · ")}`;
                  })()
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
                  : "⤓ Render MP4"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── COMMAND PALETTE ───────────── */

type PaletteAction = {
  id: string;
  label: string;
  keywords?: string;
  run: () => void;
};

function CommandPalette({
  actions,
  onClose,
}: {
  actions: PaletteAction[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions.slice(0, 60);
    const tokens = q.split(/\s+/);
    return actions
      .map((a) => {
        const hay = `${a.label} ${a.keywords ?? ""}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          const idx = hay.indexOf(t);
          if (idx < 0) return null;
          score += 100 - Math.min(99, idx);
        }
        return { a, score };
      })
      .filter((x): x is { a: PaletteAction; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((x) => x.a);
  }, [query, actions]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${highlightIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog">
        <input
          autoFocus
          className="palette-input"
          type="text"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightIdx((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const action = filtered[highlightIdx];
              if (action) {
                action.run();
                onClose();
              }
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            filtered.map((a, i) => (
              <button
                key={a.id}
                data-idx={i}
                type="button"
                className={`palette-item ${i === highlightIdx ? "active" : ""}`}
                onMouseEnter={() => setHighlightIdx(i)}
                onClick={() => {
                  a.run();
                  onClose();
                }}
              >
                {a.label}
              </button>
            ))
          )}
        </div>
        <div className="palette-foot">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
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
      title: "// COMMAND",
      items: [
        { keys: [`${mod} K`], label: "Command palette" },
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
  const [showExperimental, setShowExperimental] = useState(false);
  const stable = PROVIDERS.filter((p) => !p.experimental);
  const experimental = PROVIDERS.filter((p) => p.experimental);
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
            {stable.map((p) => {
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

            {experimental.length > 0 ? (
              <div className="providers-experimental">
                <button
                  type="button"
                  className="providers-experimental-toggle"
                  onClick={() => setShowExperimental((v) => !v)}
                >
                  {showExperimental ? "▾" : "▸"} // COMING IN v2 — {experimental.length} provider{experimental.length === 1 ? "" : "s"}
                </button>
                {showExperimental
                  ? experimental.map((p) => {
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
                    })
                  : null}
              </div>
            ) : null}
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
