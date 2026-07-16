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
  GraphicOverlay,
  Grade,
  MusicSegment,
  Project,
  Section,
  Transition,
  TransitionType,
  Version,
  VOSegment,
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
import { buildCubeLUT, gradeDescriptor, gradeToCssFilter } from "@/lib/grade";
import { putAsset, fetchToAsset, isAssetUri } from "@/lib/asset-store";
import { useAssetUrl } from "@/lib/use-asset-url";
import { startJob, abortJob, endJob } from "@/lib/abort-jobs";
import {
  formatTimecode,
  formatTransition,
  formatCost,
  templateIcon,
  useClickOutside,
  Popover,
  InlineText,
  AssetImg,
  AssetVideo,
  AssetAudio,
  Waveform,
  Field,
} from "@/components/primitives";
import {
  isAbortError,
  pickFile,
  blobToDataUrl,
  dataUrlToAsset,
  resolveToApiDataUrl,
  canBrowserPlayVideo,
  canBrowserPlayAudio,
  extractVideoPosterDataUrl,
  measureAudioDuration,
} from "@/lib/media";
import {
  sectionVersionExists,
  stillExists,
  voSegmentExists,
  musicSegmentExists,
  projectHasGeneratedContent,
  sectionHasImportedContent,
} from "@/lib/store-guards";
import {
  TransitionEditor,
  GraphicOverlayEditor,
  VOSegmentEditor,
  MusicSegmentEditor,
  LookSlot,
  LibrarySection,
  BriefEditor,
  GradeEditor,
  MusicEditor,
  TitleStyleEditor,
  loadGoogleFont,
} from "@/components/editors";
import {
  RenderDialog,
  CommandPalette,
  HelpDialog,
  ProvidersDialog,
} from "@/components/dialogs";

// Late-write guards: if the user deleted a section / version / segment
// while a generation request was in flight, the result write would
// otherwise reanimate or stomp fresh edits. Check existence before writing.

const ASPECT_OPTIONS: Aspect[] = ["9:16", "16:9", "1:1"];

const SECTION_DURATION_OPTIONS_S = [1, 2, 3, 4, 5, 6, 8, 10];

/* ───────────── PRIMITIVES ───────────── */

// Small wrappers that resolve `assetdb:` URIs (IndexedDB-backed persisted
// blobs) to fresh `blob:` URLs before passing to native elements. For sites
// that need a ref (PreviewStage video, PreviewAudio music), the hook is
// called directly inline instead.

// Persist a data URL into the IndexedDB asset store; falls back to the
// data URL itself if the store is unavailable.

// Resolve any locally-persisted URL to a data URL suitable for sending to
// a provider API (Replicate and Runway both accept data URIs as image
// inputs). http(s)/data: URLs pass through untouched.

// Browsers vary on which audio formats they decode. AIFF / Apple Lossless /
// some legacy codecs work in Safari but not Chrome/Firefox. Quick check up
// front so the user gets a clear "not supported" warning instead of a silent
// audio element that won't play.
// Same idea as canBrowserPlayAudio, but for video imports. .mov from iPhones
// usually works (H.264), but .mkv / .avi / .wmv / .flv often fail.

// Pull the first viewable frame of a video file out as a JPEG data URL so the
// timeline thumb has something to render. The clip-thumb only looks at the
// still's output_url, and importing a video would otherwise leave the still
// empty (or worse, point at a broken URL from a prior import).
// A clip is "imported" when its active version output OR active still points at
// local content (blob: from URL.createObjectURL or data:). For these we open a
// simplified panel — re-import, rename, resize, delete — instead of the full
// still/motion generation UI, since there's nothing to generate.

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
  const addMusicSegment = useStore((s) => s.addMusicSegment);
  const updateMusicSegment = useStore((s) => s.updateMusicSegment);
  const removeMusicSegment = useStore((s) => s.removeMusicSegment);
  const addGraphic = useStore((s) => s.addGraphic);
  const updateGraphic = useStore((s) => s.updateGraphic);
  const removeGraphic = useStore((s) => s.removeGraphic);
  const updateBrief = useStore((s) => s.updateBrief);
  const updateGrade = useStore((s) => s.updateGrade);
  const setGrade = useStore((s) => s.setGrade);
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

  // Recover from sessionStorage draft on mount (e.g. after accidental tab close)
  useEffect(() => {
    if (!hydrated) return;
    const draftStr = sessionStorage.getItem("cinema_draft_project");
    if (!draftStr) return;
    try {
      const draft = JSON.parse(draftStr) as Project;
      const draftSectionId = sessionStorage.getItem("cinema_draft_activeSection") || null;
      // Consume the draft up front so declining (or Esc) never re-prompts;
      // beforeunload writes a fresh one on the next exit anyway.
      sessionStorage.removeItem("cinema_draft_project");
      sessionStorage.removeItem("cinema_draft_activeSection");
      const persisted = useStore.getState().project;
      // Zustand persist already restores state on reload; only offer recovery
      // when the draft has changes the persisted store doesn't.
      if (draft.updated_at === persisted.updated_at) return;
      confirmAsk({
        title: "Recover unsaved draft?",
        message: "It looks like you had a project open. Would you like to restore it?",
        confirm_label: "Restore",
        cancel_label: "Start fresh",
        destructive: false,
        onConfirm: () => {
          useStore.getState().setProject(draft);
          useStore.getState().setActiveSection(draftSectionId);
          toast.info("Draft restored");
        },
      });
    } catch {
      // Draft is corrupted, ignore
    }
  }, [hydrated]);

  // Save project to sessionStorage on beforeunload to recover from accidental tab close
  useEffect(() => {
    const saveOnUnload = () => {
      try {
        sessionStorage.setItem("cinema_draft_project", JSON.stringify(project));
        sessionStorage.setItem("cinema_draft_activeSection", activeSectionId || "");
      } catch {
        // Session storage full or unavailable, ignore
      }
    };
    window.addEventListener("beforeunload", saveOnUnload);
    return () => window.removeEventListener("beforeunload", saveOnUnload);
  }, [project, activeSectionId]);

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
  const savedRecord = savedProjectsMap[project.id];
  const isDirty = !savedRecord || savedRecord.updated_at !== project.updated_at;
  const isInLibrary = !!savedRecord;

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
  const [editingGraphicId, setEditingGraphicId] = useState<string | null>(null);
  const [editingVOId, setEditingVOId] = useState<string | null>(null);
  const [editingMusicId, setEditingMusicId] = useState<string | null>(null);
  const [sectionEditorOpen, setSectionEditorOpen] = useState(false);
  const [musicPanelOpen, setMusicPanelOpen] = useState(false);
  const [lookOpen, setLookOpen] = useState<null | "brief" | "grade" | "title">(null);
  const [libTab, setLibTab] = useState<"projects" | "templates">("projects");
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [playPosition, setPlayPosition] = useState<number | null>(null);
  const [playheadSeconds, setPlayheadSeconds] = useState<number>(0);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playRAFRef = useRef<number | null>(null);
  const playStartedAtRef = useRef<number>(0);

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

  const stopPreview = useCallback(() => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    if (playRAFRef.current !== null) cancelAnimationFrame(playRAFRef.current);
    playTimerRef.current = null;
    playRAFRef.current = null;
    setPlayPosition(null);
  }, []);

  const [voJobs, setVoJobs] = useState<Record<string, { status: "running" | "error"; error?: string }>>({});
  const [musicJob, setMusicJob] = useState<{ status: "running" | "error"; error?: string } | null>(null);
  const [musicSegJobs, setMusicSegJobs] = useState<Record<string, { status: "running" | "error"; error?: string }>>({});

  const handleGenerateMusicSegment = useCallback(
    async (segmentId: string) => {
      const seg = (project.music_segments ?? []).find((s) => s.id === segmentId);
      if (!seg) return;
      if (!seg.prompt.trim()) {
        toast.warn("Add a music prompt first.");
        return;
      }
      setMusicSegJobs((j) => ({ ...j, [segmentId]: { status: "running" } }));
      const jobKey = `music:${segmentId}`;
      const ctrl = startJob(jobKey);
      try {
        let dataUrl: string;
        if (isReplicateMusicModel(seg.model)) {
          const key = providerKeys.replicate;
          if (!key) {
            setMusicSegJobs((j) => { const next = { ...j }; delete next[segmentId]; return next; });
            confirmAsk({
              title: "Replicate key needed",
              message: "Stable Audio runs on Replicate. Open Providers to add a key?",
              confirm_label: "Open Providers",
              cancel_label: "Not now",
              onConfirm: () => setProvidersOpen(true),
            });
            return;
          }
          const url = await runReplicateMusic({
            model: seg.model,
            prompt: seg.prompt,
            durationSeconds: seg.duration_s,
            apiToken: key,
            signal: ctrl.signal,
          });
          if (ctrl.signal.aborted) return;
          dataUrl = await fetchAsDataUrl(url, ctrl.signal);
        } else {
          const key = providerKeys.elevenlabs;
          if (!key) {
            setMusicSegJobs((j) => { const next = { ...j }; delete next[segmentId]; return next; });
            confirmAsk({
              title: "ElevenLabs key needed",
              message: "ElevenLabs needs an API key to generate music. Open Providers to add one?",
              confirm_label: "Open Providers",
              cancel_label: "Not now",
              onConfirm: () => setProvidersOpen(true),
            });
            return;
          }
          dataUrl = await runElevenLabsMusic({
            prompt: seg.prompt,
            durationMs: Math.round(seg.duration_s * 1000),
            apiKey: key,
            signal: ctrl.signal,
          });
        }
        if (ctrl.signal.aborted) return;
        if (!musicSegmentExists(segmentId)) return;
        updateMusicSegment(segmentId, { output_url: dataUrl });
        setMusicSegJobs((j) => { const next = { ...j }; delete next[segmentId]; return next; });
      } catch (err) {
        if (isAbortError(err)) {
          setMusicSegJobs((j) => { const next = { ...j }; delete next[segmentId]; return next; });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setMusicSegJobs((j) => ({ ...j, [segmentId]: { status: "error", error: message } }));
      } finally {
        endJob(jobKey);
      }
    },
    [project.music_segments, providerKeys.replicate, providerKeys.elevenlabs, updateMusicSegment],
  );

  const handleGenerateMusic = useCallback(async () => {
    const music = project.music_track;
    if (!music || !music.prompt.trim()) {
      toast.warn("Add a music prompt first.");
      return;
    }
    setMusicJob({ status: "running" });
    const jobKey = "music_track";
    const ctrl = startJob(jobKey);
    try {
      let dataUrl: string;
      if (isReplicateMusicModel(music.model)) {
        const key = providerKeys.replicate;
        if (!key) {
          setMusicJob(null);
          confirmAsk({
            title: "Replicate key needed",
            message: "Stable Audio runs on Replicate. Open Providers to add a key?",
            confirm_label: "Open Providers",
            cancel_label: "Not now",
            onConfirm: () => setProvidersOpen(true),
          });
          return;
        }
        const url = await runReplicateMusic({
          model: music.model,
          prompt: music.prompt,
          durationSeconds: project.duration_s,
          apiToken: key,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        dataUrl = await fetchAsDataUrl(url, ctrl.signal);
      } else {
        const key = providerKeys.elevenlabs;
        if (!key) {
          setMusicJob(null);
          confirmAsk({
            title: "ElevenLabs key needed",
            message: "ElevenLabs needs an API key to generate music. Open Providers to add one?",
            confirm_label: "Open Providers",
            cancel_label: "Not now",
            onConfirm: () => setProvidersOpen(true),
          });
          return;
        }
        dataUrl = await runElevenLabsMusic({
          prompt: music.prompt,
          durationMs: Math.round(project.duration_s * 1000),
          apiKey: key,
          signal: ctrl.signal,
        });
      }
      if (ctrl.signal.aborted) return;
      updateMusic({ output_url: dataUrl });
      setMusicJob(null);
    } catch (err) {
      if (isAbortError(err)) { setMusicJob(null); return; }
      const message = err instanceof Error ? err.message : String(err);
      setMusicJob({ status: "error", error: message });
    } finally {
      endJob(jobKey);
    }
  }, [project.music_track, project.duration_s, providerKeys.elevenlabs, providerKeys.replicate, updateMusic]);

  const handleGenerateVO = useCallback(
    async (segmentId: string) => {
      const seg = project.vo_segments.find((v) => v.id === segmentId);
      if (!seg) return;
      const key = providerKeys.elevenlabs;
      if (!key) {
        confirmAsk({
          title: "ElevenLabs key needed",
          message: "ElevenLabs needs an API key to generate voice. Open Providers to add one?",
          confirm_label: "Open Providers",
          cancel_label: "Not now",
          onConfirm: () => setProvidersOpen(true),
        });
        return;
      }
      if (!seg.text.trim()) {
        toast.warn("Add text to the VO segment first.");
        return;
      }
      setVoJobs((j) => ({ ...j, [segmentId]: { status: "running" } }));
      const jobKey = `vo:${segmentId}`;
      const ctrl = startJob(jobKey);
      try {
        const dataUrl = await runElevenLabsTTS({
          voice: seg.voice,
          text: seg.text,
          apiKey: key,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        // Measure the actual audio duration so the segment's window on the
        // timeline matches the generated speech — the 3s default can chop a
        // longer line, and a fully-fit window lets one VO span multiple clips.
        const measured = await measureAudioDuration(dataUrl).catch(() => null);
        if (ctrl.signal.aborted) return;
        if (!voSegmentExists(segmentId)) return;
        const projectDuration = useStore.getState().project.duration_s;
        const patch: Partial<Omit<VOSegment, "id">> = { output_url: dataUrl };
        if (measured && Number.isFinite(measured) && measured > 0) {
          const maxFit = Math.max(0.5, projectDuration - seg.start_s);
          patch.duration_s = Math.min(measured, maxFit);
        }
        updateVOSegment(segmentId, patch);
        setVoJobs((j) => {
          const next = { ...j };
          delete next[segmentId];
          return next;
        });
      } catch (err) {
        if (isAbortError(err)) {
          setVoJobs((j) => { const next = { ...j }; delete next[segmentId]; return next; });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setVoJobs((j) => ({ ...j, [segmentId]: { status: "error", error: message } }));
      } finally {
        endJob(jobKey);
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

  const currentPreviewIndex = useMemo(() => {
    if (playPosition !== null) return playPosition;
    const i = project.sections.findIndex((s) => s.id === activeSectionId);
    return i >= 0 ? i : 0;
  }, [playPosition, activeSectionId, project.sections]);

  const previewStartSeconds = useMemo(
    () => project.sections.slice(0, currentPreviewIndex).reduce((acc, s) => acc + s.duration_s, 0),
    [project.sections, currentPreviewIndex],
  );

  const activeSectionStartS = useMemo(() => {
    const idx = project.sections.findIndex((s) => s.id === activeSectionId);
    if (idx < 0) return playheadSeconds;
    return project.sections.slice(0, idx).reduce((a, s) => a + s.duration_s, 0);
  }, [project.sections, activeSectionId, playheadSeconds]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      // Treat <input>, <textarea>, <select>, and any contenteditable as
      // "typing surface" — global single-key shortcuts must not fire there.
      const editable =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        !!target?.isContentEditable ||
        !!target?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
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
      // Esc dismisses dialogs regardless of focus — including inputs inside
      // the section editor modal, which previously bailed on the editable check.
      if (e.key === "Escape") {
        if (useConfirm.getState().prompt) { useConfirm.getState().cancel(); return; }
        if (paletteOpen) { setPaletteOpen(false); return; }
        if (helpOpen) { setHelpOpen(false); return; }
        if (renderOpen) { setRenderOpen(false); return; }
        if (providersOpen) { setProvidersOpen(false); return; }
        if (musicPanelOpen) { setMusicPanelOpen(false); return; }
        if (editingVOId) { setEditingVOId(null); return; }
        if (editingMusicId) { setEditingMusicId(null); return; }
        if (editingGraphicId) { setEditingGraphicId(null); return; }
        if (lookOpen) { setLookOpen(null); return; }
        if (sectionEditorOpen) {
          if (editable) (e.target as HTMLElement)?.blur?.();
          setSectionEditorOpen(false);
          return;
        }
        if (activeSectionId) {
          if (editable) (e.target as HTMLElement)?.blur?.();
          setActiveSection(null);
          return;
        }
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
        confirmAsk({
          title: `Delete "${sec.title}"?`,
          message: `Removes section ${sec.index.toString().padStart(2, "0")} from the timeline. Generated content for this section will be lost.`,
          confirm_label: "Delete",
          cancel_label: "Keep",
          destructive: true,
          onConfirm: () => {
            removeSection(activeSectionId);
            toast.info(`Removed "${sec.title}"`);
          },
        });
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
    musicPanelOpen,
    editingVOId,
    editingMusicId,
    editingGraphicId,
    sectionEditorOpen,
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

  const requestAspectChange = useCallback(
    (next: Aspect) => {
      if (next === project.aspect) return;
      if (!projectHasGeneratedContent(project)) {
        updateProjectMeta({ aspect: next });
        return;
      }
      confirmAsk({
        title: `Switch aspect to ${next}?`,
        message: `Your existing stills and clips were generated at ${project.aspect}. They'll stay on the timeline but won't match the new aspect — re-generating them at ${next} will use your provider API credits (Replicate, Runway, etc.) one clip at a time. AI Cinema itself stays free.`,
        confirm_label: `Switch to ${next}`,
        cancel_label: "Keep current",
        destructive: false,
        onConfirm: () => updateProjectMeta({ aspect: next }),
      });
    },
    [project, updateProjectMeta],
  );

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
      <div className="mobile-gate" role="dialog" aria-label="Best on desktop">
        <div className="mobile-gate-card">
          <div className="mobile-gate-brand"><span className="ai">AI</span> Cinema</div>
          <div className="mobile-gate-title">// BEST ON DESKTOP</div>
          <p>
            AI Cinema is a timeline-driven editor with drag-and-drop, keyboard shortcuts, and an
            ffmpeg renderer running in your browser. It needs a wide screen.
          </p>
          <p>
            Open <strong>ai-cinema-red.vercel.app</strong> on a laptop or desktop with at least a
            900px-wide window.
          </p>
        </div>
      </div>

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
          <button
            type="button"
            className="status-link"
            onClick={() => setProvidersOpen(true)}
            title="Manage provider API keys"
            aria-label="Open Providers"
          >
            🔑 KEYS{configuredKeyCount > 0 ? ` (${configuredKeyCount})` : ""}
          </button>
          <button
            type="button"
            className="status-link"
            onClick={() => setHelpOpen(true)}
            title="Help & keyboard shortcuts"
            aria-label="Open help"
          >
            ?
          </button>
          <span>{hydrated ? "STATE // PERSISTED" : "STATE // EPHEMERAL"}</span>
          <UserStatusChip />
        </div>
      </div>

      <div className="hero">
        <span className="hero-brand"><span className="ai">AI</span> Cinema</span>
        <a
          className="cta-hero"
          href="/signup"
          title="Create a free account to save projects across devices"
          aria-label="Sign up for a free account"
        >
          Let&apos;s Go! <span className="cta-hero-sub">— it&apos;s free</span>
        </a>
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
                    ? "Edited since last save — ⌘S to save again"
                    : "In sync with the saved copy"
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
                      requestAspectChange(a);
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
              onClick={() => requestAspectChange(a)}
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
              // Hard replace, not merge — old adjustments (missing keys like
              // saturation) shouldn't bleed through and zero out the preset.
              setGrade(rest);
            }}
            onSaveAs={(name) => project.grade && saveGradeToLibrary(project.grade, name)}
            onRemovePreset={(id) => removeLibraryItem("grade", id)}
            onRenamePreset={(id, name) => renameLibraryItem("grade", id, name)}
            onClose={() => setLookOpen(null)}
          />
        </LookSlot>
        </div>
      </div>

      <PreviewStage
        project={project}
        currentIndex={currentPreviewIndex}
        startSeconds={previewStartSeconds}
        isPlaying={playPosition !== null}
        onTogglePlay={togglePreview}
      />

      <StageControls
        project={project}
        currentIndex={currentPreviewIndex}
        startSeconds={previewStartSeconds}
        isPlaying={playPosition !== null}
        onTogglePlay={togglePreview}
        onStop={stopPreview}
      />

      <div className="timeline-wrap">
        <div className="tl-label">
          <span>// TIMELINE</span>
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

        <div className="tl-row-label">
          // GRAPHICS
          <div className="tl-row-actions">
            <button
              type="button"
              className="tl-row-import-btn"
              title="Import an image (PNG/JPG/SVG/GIF/WebP) or text file as a graphic overlay"
              aria-label="Import graphic"
              onClick={async () => {
                const file = await pickFile("image/*,.txt,text/plain");
                if (!file) return;
                const isImage = file.type.startsWith("image/") ||
                  /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i.test(file.name);
                addGraphic(activeSectionStartS);
                setEditingGraphicId(null);
                const last = (useStore.getState().project.graphics ?? []).slice(-1)[0];
                if (last) {
                  if (isImage) {
                    const persistedUrl = await putAsset(file);
                    updateGraphic(last.id, {
                      image_url: persistedUrl,
                      text: file.name.replace(/\.[^.]+$/, ""),
                      label: file.name,
                    });
                  } else {
                    const text = await file.text();
                    updateGraphic(last.id, { text: text.trim().slice(0, 200), label: file.name });
                  }
                }
                toast.success("Graphic imported", file.name);
              }}
            >
              ▤ IMPORT
            </button>
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
            <div className="graphics-empty" />
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

        <div className="tl-row-label">
          // VIDEO
          <div className="tl-row-actions">
            <button
              type="button"
              className="tl-row-import-btn"
              title="Import an image (becomes a still) or a video (becomes a clip) as a new scene"
              aria-label="Import video or image as new scene"
              onClick={async () => {
                const file = await pickFile("image/*,video/*,.mp4,.m4v,.mov,.webm,.ogv,.ogg,.3gp,.3g2");
                if (!file) return;
                const isVideo =
                  file.type.startsWith("video/") ||
                  /\.(mp4|m4v|mov|webm|ogv|ogg|3gp|3g2|mkv|avi|wmv|flv)$/i.test(file.name);
                if (isVideo) {
                  const check = canBrowserPlayVideo(file);
                  if (!check.ok) {
                    toast.error("Unsupported video format", check.reason);
                    return;
                  }
                }
                // Persist large blobs in IndexedDB so they survive refresh;
                // small images can ride as data URLs in localStorage.
                const persistedUrl = await putAsset(file);
                const posterDataUrl = isVideo ? await extractVideoPosterDataUrl(file) : null;
                const poster = posterDataUrl ? await dataUrlToAsset(posterDataUrl) : null;
                const videoDuration = isVideo
                  ? await measureAudioDuration(persistedUrl).catch(() => null)
                  : null;
                addClipSection(null);
                useStore.getState().setActiveSection(null);
                const stateAfter = useStore.getState();
                const sections = stateAfter.project.sections;
                const last = sections[sections.length - 1];
                if (!last) return;
                if (isVideo) {
                  const ver = last.versions.find((v) => v.id === last.active_version_id);
                  if (ver && ver.kind === "clip") {
                    updateClipVersion(last.id, ver.id, { output_url: persistedUrl });
                  }
                  if (poster) {
                    const still = last.stills.find((s) => s.id === last.active_still_id);
                    if (still) updateStill(last.id, still.id, { output_url: poster });
                  }
                  if (videoDuration && Number.isFinite(videoDuration) && videoDuration > 0) {
                    useStore.getState().updateSection(last.id, { duration_s: videoDuration });
                    // The new section's start_s = sum of prior section durations.
                    // Add the video's audio as a music segment at the same time slot.
                    const priorSections = sections.slice(0, -1);
                    const startS = priorSections.reduce((a, s) => a + s.duration_s, 0);
                    addMusicSegment();
                    const lastMusic = (useStore.getState().project.music_segments ?? []).slice(-1)[0];
                    if (lastMusic) {
                      updateMusicSegment(lastMusic.id, {
                        output_url: persistedUrl,
                        name: file.name.replace(/\.[^.]+$/, "") + " (audio)",
                        start_s: startS,
                        duration_s: videoDuration,
                      });
                    }
                  }
                  toast.success("Video imported", `${file.name} · new scene with audio`);
                } else {
                  const still = last.stills.find((s) => s.id === last.active_still_id);
                  if (still) {
                    updateStill(last.id, still.id, { output_url: persistedUrl });
                  }
                  toast.success("Image imported", `${file.name} · new scene`);
                }
              }}
            >
              ▤ IMPORT
            </button>
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
            if (isTitle) {
              return <div key={section.id} className="title-placeholder" aria-hidden />;
            }
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
                onClick={() => { setActiveSection(section.id); setSectionEditorOpen(true); }}
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
                        <AssetImg src={thumb} alt={section.title} />
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
                <div className="clip-num">
                  <span className={`clip-dot clip-dot-${readyKind}`} title={
                    readyKind === "ready" ? "Motion rendered" :
                    readyKind === "still" ? "Still ready, motion pending" :
                    readyKind === "draft" ? "Draft — nothing generated" :
                    "Missing"
                  } />
                  {section.index.toString().padStart(2, "0")} // {cellKind}
                </div>
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
                      confirmAsk({
                        title: `Delete "${section.title}"?`,
                        message: `Removes section ${section.index.toString().padStart(2, "0")} from the timeline. Generated content for this section will be lost.`,
                        confirm_label: "Delete",
                        cancel_label: "Keep",
                        destructive: true,
                        onConfirm: () => {
                          removeSection(section.id);
                          toast.info(`Removed "${section.title}"`);
                        },
                      });
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="tl-row-label">
          // VOICEOVER
          <div className="tl-row-actions">
            <button
              type="button"
              className="tl-row-import-btn"
              title="Import an audio file as a new VO segment"
              aria-label="Import voiceover file"
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
                addVOSegment();
                setEditingVOId(null);
                const last = useStore.getState().project.vo_segments.slice(-1)[0];
                if (last) {
                  const patch: Partial<Omit<VOSegment, "id">> = { output_url: persistedUrl, text: file.name.replace(/\.[^.]+$/, "") };
                  if (measured && Number.isFinite(measured) && measured > 0) patch.duration_s = measured;
                  updateVOSegment(last.id, patch);
                }
                toast.success("VO imported", file.name);
              }}
            >
              ▤ IMPORT
            </button>
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
              className="tl-row-import-btn"
              title="Import an audio file as a new music segment"
              aria-label="Import music file"
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
                addMusicSegment();
                setEditingMusicId(null);
                setMusicPanelOpen(false);
                const last = (useStore.getState().project.music_segments ?? []).slice(-1)[0];
                if (last) {
                  const patch: Partial<Omit<MusicSegment, "id">> = { output_url: persistedUrl, name: file.name.replace(/\.[^.]+$/, "") };
                  if (measured && Number.isFinite(measured) && measured > 0) patch.duration_s = measured;
                  updateMusicSegment(last.id, patch);
                }
                toast.success("Music imported", file.name);
              }}
            >
              ▤ IMPORT
            </button>
            <button
              type="button"
              className="tl-row-add-btn"
              onClick={() => addMusicSegment()}
              title="Add a music segment"
            >
              + MUSIC
            </button>
          </div>
        </div>
        <div className="audio-row vo-row">
          <MusicTrack
            segments={project.music_segments ?? []}
            duration={project.duration_s}
            editingMusicId={editingMusicId}
            setEditingMusicId={setEditingMusicId}
            updateMusicSegment={updateMusicSegment}
          />
        </div>

        <div className="audio-row" style={{ marginTop: 12 }}>
          <div className="grade-strip">
            <button
              type="button"
              className="grade-strip-main"
              onClick={() => setLookOpen("grade")}
            >
              <span>
                Final pass · <strong>{project.grade?.name ?? "—"}</strong>
                {project.grade ? ` · ${gradeDescriptor(project.grade)}` : ""}
              </span>
            </button>
          </div>
        </div>
      </div>

      {activeSection && sectionEditorOpen ? (
        <div className="flow-modal-overlay" onClick={() => setSectionEditorOpen(false)}>
          <div className="flow-modal" onClick={(e) => e.stopPropagation()}>
            {sectionHasImportedContent(activeSection) ? (
              <ImportedClipPanel
                section={activeSection}
                onClose={() => setSectionEditorOpen(false)}
              />
            ) : (
              <FlowPanel
                section={activeSection}
                project={project}
                providerKeys={providerKeys}
                onOpenProviders={() => setProvidersOpen(true)}
                onProviderKeyMissing={() => setProvidersOpen(true)}
                onClose={() => setSectionEditorOpen(false)}
              />
            )}
          </div>
        </div>
      ) : null}

      {editingGraphicId ? (() => {
        const eg = (project.graphics ?? []).find((g) => g.id === editingGraphicId);
        if (!eg) return null;
        return (
          <div className="flow-modal-overlay" onClick={() => setEditingGraphicId(null)}>
            <div className="flow-modal" onClick={(e) => e.stopPropagation()}>
              <GraphicOverlayEditor
                overlay={eg}
                projectDuration={project.duration_s}
                onChange={(patch) => updateGraphic(eg.id, patch)}
                onRemove={() => {
                  confirmAsk({
                    title: "Delete graphic?",
                    message: "This cannot be undone.",
                    confirm_label: "Delete",
                    cancel_label: "Keep",
                    destructive: true,
                    onConfirm: () => {
                      removeGraphic(eg.id);
                      setEditingGraphicId(null);
                    },
                  });
                }}
              />
            </div>
          </div>
        );
      })() : null}

      {editingMusicId ? (() => {
        const seg = (project.music_segments ?? []).find((s) => s.id === editingMusicId);
        if (!seg) return null;
        return (
          <div className="flow-modal-overlay" onClick={() => setEditingMusicId(null)}>
            <div className="flow-modal" onClick={(e) => e.stopPropagation()}>
              <MusicSegmentEditor
                segment={seg}
                projectDuration={project.duration_s}
                job={musicSegJobs[seg.id]}
                hasKey={!!providerKeys.elevenlabs || !!providerKeys.replicate}
                onChange={(patch) => updateMusicSegment(seg.id, patch)}
                onGenerate={() => handleGenerateMusicSegment(seg.id)}
                onDismissError={() => setMusicSegJobs((j) => { const next = { ...j }; delete next[seg.id]; return next; })}
                onRemove={() => { removeMusicSegment(seg.id); setEditingMusicId(null); }}
              />
            </div>
          </div>
        );
      })() : null}

      {editingVOId ? (() => {
        const seg = project.vo_segments.find((s) => s.id === editingVOId);
        if (!seg) return null;
        return (
          <div className="flow-modal-overlay" onClick={() => setEditingVOId(null)}>
            <div className="flow-modal" onClick={(e) => e.stopPropagation()}>
              <VOSegmentEditor
                segment={seg}
                projectDuration={project.duration_s}
                job={voJobs[seg.id]}
                hasKey={!!providerKeys.elevenlabs}
                onChange={(patch) => updateVOSegment(seg.id, patch)}
                onGenerate={() => handleGenerateVO(seg.id)}
                onDismissError={() => setVoJobs((j) => { const next = { ...j }; delete next[seg.id]; return next; })}
                onRemove={() => {
                  confirmAsk({
                    title: "Delete VO segment?",
                    message: "The generated audio will be lost.",
                    confirm_label: "Delete",
                    cancel_label: "Keep",
                    destructive: true,
                    onConfirm: () => {
                      removeVOSegment(seg.id);
                      setEditingVOId(null);
                    },
                  });
                }}
              />
            </div>
          </div>
        );
      })() : null}

      {musicPanelOpen ? (
        <div className="flow-modal-overlay" onClick={() => setMusicPanelOpen(false)}>
          <div className="flow-modal" onClick={(e) => e.stopPropagation()}>
            <MusicEditor
              music={project.music_track}
              library={libraryMusic}
              job={musicJob ?? undefined}
              hasKey={!!providerKeys.elevenlabs}
              durationS={project.duration_s}
              onChange={updateMusic}
              onLoadPreset={(item) => updateMusic(item)}
              onSaveAs={(name) => project.music_track && saveMusicToLibrary(project.music_track, name)}
              onRemovePreset={(id) => removeLibraryItem("music", id)}
              onRenamePreset={(id, name) => renameLibraryItem("music", id, name)}
              onGenerate={handleGenerateMusic}
              onDismissError={() => setMusicJob(null)}
              onClose={() => setMusicPanelOpen(false)}
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
              label: "New graphic",
              keywords: "add insert title card graphic",
              run: () => { addTitleSection(null); toast.info("Added title"); },
            },
            {
              id: "save",
              label: "Save project to library",
              keywords: "save project library s",
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
        <div className="lib-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={libTab === "projects"}
            className={`lib-tab ${libTab === "projects" ? "active" : ""}`}
            onClick={() => setLibTab("projects")}
          >
            <span className="lib-tab-icon" aria-hidden>⊞</span> // PROJECTS
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={libTab === "templates"}
            className={`lib-tab ${libTab === "templates" ? "active" : ""}`}
            onClick={() => setLibTab("templates")}
          >
            <span className="lib-tab-icon" aria-hidden>⚀</span> // TEMPLATES
          </button>
        </div>
        <div className="lib-body">
          {libTab === "projects" ? (
          <>
          <button
            type="button"
            className="lib-save"
            onClick={() => {
              saveProjectToLibrary(project);
              toast.success("Saved to library", project.name);
            }}
            title="Save current project (⌘S)"
          >
            <span className="lib-tab-icon" aria-hidden>⊞</span> Save current project
          </button>
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
                        : `Load saved project ${p.name} — replaces current project`
                    }
                    title={
                      isOpen
                        ? "Currently loaded — edits flow into the live project"
                        : "Click to load · current project is auto-saved first"
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
                        toast.success("Loaded project", `${p.name} · ${p.sections.length} sections`);
                      } else {
                        toast.error("Load failed", "Saved project not found in library");
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
          </>
          ) : (
          <div className="lib-list">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="lib-row"
                onClick={() => {
                  confirmAsk({
                    title: `Load ${t.name}?`,
                    message: `This replaces your current project with the template. Want to save your current project as a saved-project (in // SAVED) first so you can come back to it?`,
                    confirm_label: "Save current & load",
                    alt_label: "Load without saving",
                    cancel_label: "Cancel",
                    destructive: false,
                    onConfirm: () => {
                      saveProjectToLibrary(project);
                      toast.success("Saved current to library", `${project.name} → // SAVED`);
                      setProject(t.build());
                    },
                    onAlt: () => setProject(t.build()),
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
          )}
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

      <PreviewAudio
        isPlaying={playPosition !== null}
        playheadSeconds={playheadSeconds}
        musicUrl={project.music_track?.output_url ?? null}
        musicSegments={project.music_segments ?? []}
        voSegments={project.vo_segments}
      />
      <ToastViewport />
      <ConfirmViewport />
    </>
  );
}

function PreviewAudio({
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

// Helper for PreviewAudio: resolves assetdb URIs and forwards the audio
// element to the parent's ref Map so play/pause/duck logic can drive it.
function RegisteredAudio({
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

function MusicTrack({
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

/* ───────────── STAGE CONTROLS ───────────── */

function StageControls({
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

/* ───────────── PREVIEW STAGE ───────────── */

function PreviewStage({
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
  const resolveAlt = useConfirm((s) => s.resolveAlt);
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
          {prompt.alt_label && prompt.onAlt ? (
            <button
              type="button"
              className="btn"
              onClick={() => { resolveAlt(); }}
            >
              {prompt.alt_label}
            </button>
          ) : null}
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


/* ───────────── TRANSITION + VO EDITORS ───────────── */

/* ───────────── IMPORTED CLIP PANEL ───────────── */
// Simpler editor for clips whose content was imported (not generated).
// Shows a preview, lets the user rename, change duration, re-import,
// or remove the section. No still/motion generation UI.
function ImportedClipPanel({
  section,
  onClose,
}: {
  section: Section;
  onClose: () => void;
}) {
  const updateSection = useStore((s) => s.updateSection);
  const updateStill = useStore((s) => s.updateStill);
  const updateClipVersion = useStore((s) => s.updateClipVersion);
  const removeSection = useStore((s) => s.removeSection);

  const activeVersion = section.versions.find((v) => v.id === section.active_version_id) ?? null;
  const motionOutput =
    activeVersion && activeVersion.kind === "clip" ? activeVersion.output_url : undefined;
  const isVideoUrl =
    motionOutput && /^(blob:|data:video|https?:)/.test(motionOutput) ? motionOutput : null;
  const stillId =
    activeVersion && activeVersion.kind === "clip"
      ? activeVersion.still_ref ?? section.active_still_id
      : section.active_still_id;
  const still = stillId ? section.stills.find((s) => s.id === stillId) ?? null : null;
  const stillUrl = still?.output_url ?? null;

  const reimport = async () => {
    const file = await pickFile("image/*,video/*,.mp4,.m4v,.mov,.webm,.ogv,.ogg");
    if (!file) return;
    const isVid =
      file.type.startsWith("video/") ||
      /\.(mp4|m4v|mov|webm|ogv|ogg|3gp|3g2)$/i.test(file.name);
    if (isVid) {
      const check = canBrowserPlayVideo(file);
      if (!check.ok) { toast.error("Unsupported video format", check.reason); return; }
    }
    const persistedUrl = await putAsset(file);
    if (isVid) {
      if (activeVersion && activeVersion.kind === "clip") {
        updateClipVersion(section.id, activeVersion.id, { output_url: persistedUrl });
      }
      const posterDataUrl = await extractVideoPosterDataUrl(file);
      const poster = posterDataUrl ? await dataUrlToAsset(posterDataUrl) : null;
      if (poster && still) {
        updateStill(section.id, still.id, { output_url: poster });
      }
      toast.success("Video re-imported", file.name);
    } else {
      if (still) {
        updateStill(section.id, still.id, { output_url: persistedUrl });
        if (activeVersion && activeVersion.kind === "clip" && activeVersion.output_url) {
          updateClipVersion(section.id, activeVersion.id, { output_url: undefined });
        }
        toast.success("Image re-imported", file.name);
      }
    }
  };

  return (
    <div className="flow-panel imported-clip-panel">
      <div className="editor-head">
        <span>
          // IMPORTED CLIP · {section.index.toString().padStart(2, "0")} {section.title}
        </span>
        <button type="button" className="btn ghost" onClick={onClose}>✕ Close</button>
      </div>
      <div className="imported-clip-preview">
        {isVideoUrl ? (
          <AssetVideo src={isVideoUrl} controls className="imported-clip-media" />
        ) : stillUrl ? (
          <AssetImg src={stillUrl} alt={section.title} className="imported-clip-media" />
        ) : (
          <div className="imported-clip-empty">no preview</div>
        )}
      </div>
      <Field label="Title">
        <input
          className="field-input"
          value={section.title}
          onChange={(e) => updateSection(section.id, { title: e.target.value })}
          placeholder="Clip title"
        />
      </Field>
      <Field label={`Duration ${section.duration_s.toFixed(1)}s`}>
        <input
          type="range"
          min={0.5}
          max={30}
          step={0.5}
          value={section.duration_s}
          onChange={(e) => updateSection(section.id, { duration_s: parseFloat(e.target.value) })}
        />
      </Field>
      <div className="gen-row">
        <button type="button" className="btn ghost" onClick={reimport}>
          ▤ Re-import
        </button>
        <button
          type="button"
          className="btn ghost danger"
          onClick={() => {
            confirmAsk({
              title: `Delete "${section.title}"?`,
              message: "Removes this imported clip from the timeline.",
              confirm_label: "Delete",
              cancel_label: "Keep",
              destructive: true,
              onConfirm: () => {
                removeSection(section.id);
                onClose();
                toast.info(`Removed "${section.title}"`);
              },
            });
          }}
        >
          ✕ Remove clip
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
  onClose,
}: {
  section: Section;
  project: Project;
  providerKeys: Partial<Record<ProviderId, string>>;
  onOpenProviders: () => void;
  onProviderKeyMissing: () => void;
  onClose: () => void;
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
    confirmAsk({
      title: `${providerName} key needed`,
      message: `${providerName} needs an API key. Open Providers to add one? (Or switch to a free model.)`,
      confirm_label: "Open Providers",
      cancel_label: "Not now",
      onConfirm: () => onProviderKeyMissing(),
    });
  };

  const COST_CAP = 0.5;

  const handleGenerateStill = async (opts?: { approvedCost?: boolean }) => {
    if (!activeStill) return;
    const jobKey = stillJobKey(section.id, activeStill.id);
    if (jobs[jobKey]?.status === "running") return;

    const modelId = activeStill.model;
    const composedPrompt = composePromptWithBrief(
      activeStill.image_prompt,
      project.brief?.visual,
    );
    const estCost = imageModelCost(modelId);
    if (estCost > COST_CAP && opts?.approvedCost !== true) {
      confirmAsk({
        title: "Over the cost cap",
        message: `Heads up — this still costs about $${estCost.toFixed(2)} (cap is $${COST_CAP.toFixed(2)}). Generate anyway?`,
        confirm_label: "Generate anyway",
        cancel_label: "Cancel",
        onConfirm: () => {
          void handleGenerateStill({ approvedCost: true });
        },
      });
      return;
    }

    if (isImageModelFree(modelId)) {
      const url = pollinationsUrl(
        activeStill.image_prompt,
        project.aspect,
        newSeed(),
        project.brief?.visual,
        providerKeys.pollinations,
      );
      const jobKey = stillJobKey(section.id, activeStill.id);
      setJob(jobKey, { status: "running", startedAt: Date.now() });
      const ctrl = startJob(jobKey);
      let throttled = false;
      try {
        const headers: HeadersInit = providerKeys.pollinations
          ? { "x-provider-key": providerKeys.pollinations }
          : {};
        const r = await fetch(url, { credentials: "omit", headers, signal: ctrl.signal });
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
        if (ctrl.signal.aborted) return;
        const blob = await r.blob();
        if (ctrl.signal.aborted) return;
        // Persist into IndexedDB — blob: URLs die on refresh, and data URLs
        // in project state eat the ~5MB localStorage quota on image-heavy
        // projects.
        const assetUrl = await putAsset(blob);
        if (!stillExists(section.id, activeStill.id)) return;
        updateStill(section.id, activeStill.id, { output_url: assetUrl });
        clearJob(jobKey);
        endJob(jobKey);
        return;
      } catch (err) {
        if (isAbortError(err)) { clearJob(jobKey); endJob(jobKey); return; }
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
              signal: ctrl.signal,
            });
            if (ctrl.signal.aborted) return;
            const fbUrl = await fetchToAsset(fallbackUrl, ctrl.signal).catch(() => fallbackUrl);
            if (ctrl.signal.aborted) return;
            if (!stillExists(section.id, activeStill.id)) return;
            updateStill(section.id, activeStill.id, { output_url: fbUrl });
            clearJob(jobKey);
            toast.success("Fallback succeeded", "Generated on Flux Schnell · switch the still's model to make it stick");
            return;
          } catch (fallbackErr) {
            if (isAbortError(fallbackErr)) { clearJob(jobKey); return; }
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
            ? `${message} Wait ~30s, add a Pollinations token (🔑 Keys → Pollinations) from enter.pollinations.ai, or add a Replicate key for automatic Flux Schnell fallback.`
            : message,
        );
      } finally {
        endJob(jobKey);
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
      const ctrl = startJob(jobKey);
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
            if (/^https?:\/\//.test(out) || isAssetUri(out)) {
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
        if (referenceImageUrl) {
          // Stills live in IndexedDB as assetdb: URIs — Replicate needs a
          // data URL (or public URL) it can actually read.
          referenceImageUrl = await resolveToApiDataUrl(referenceImageUrl);
        }
        const url = await runReplicateImage({
          model: modelId,
          prompt: composedPrompt,
          aspect: project.aspect,
          apiToken: token,
          referenceImageUrl,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        // Persist into IndexedDB — Replicate's signed delivery URLs expire
        // after ~24h, so storing the URL alone breaks every still tomorrow.
        const assetUrl = await fetchToAsset(url, ctrl.signal).catch(() => url);
        if (ctrl.signal.aborted) return;
        if (!stillExists(section.id, activeStill.id)) return;
        updateStill(section.id, activeStill.id, { output_url: assetUrl });
        clearJob(jobKey);
      } catch (err) {
        if (isAbortError(err)) { clearJob(jobKey); return; }
        const message = err instanceof Error ? err.message : String(err);
        setJob(jobKey, { status: "error", error: message });
      } finally {
        endJob(jobKey);
      }
      return;
    }

    toast.info(
      `Live ${modelId} isn't wired yet`,
      "Switch to Pollinations (free) or Flux / Schnell / SDXL / Ideogram (Replicate).",
    );
  };

  const handleGenerateMotion = async (opts?: { approvedCost?: boolean }) => {
    if (!activeVersion || activeVersion.kind !== "clip") return;
    const jobKey = motionJobKey(section.id, activeVersion.id);
    if (jobs[jobKey]?.status === "running") return;

    const modelId = activeVersion.motion.model;
    const estMotionCost = motionModelCost(modelId, activeVersion.motion.duration_s);
    if (estMotionCost > COST_CAP && opts?.approvedCost !== true) {
      confirmAsk({
        title: "Over the cost cap",
        message: `Heads up — this motion costs about $${estMotionCost.toFixed(2)} (cap is $${COST_CAP.toFixed(2)}). Generate anyway?`,
        confirm_label: "Generate anyway",
        cancel_label: "Cancel",
        onConfirm: () => {
          void handleGenerateMotion({ approvedCost: true });
        },
      });
      return;
    }

    if (isMotionModelFree(modelId)) {
      const stillToUse = referencedStill;
      if (stillToUse && !stillToUse.output_url && isImageModelFree(stillToUse.model)) {
        // Store a direct (no-token) pollinations URL — <img> tags can't send
        // the x-provider-key header the proxy needs. Users who want reliable
        // stills should use the explicit Generate still path, which proxies.
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
      const ctrl = startJob(jobKey);
      try {
        const videoUrl = await runReplicateMotion({
          model: modelId,
          prompt: composedPrompt,
          firstFrameUrl: await resolveToApiDataUrl(stillToUse.output_url),
          durationSeconds: activeVersion.motion.duration_s || section.duration_s,
          aspect: project.aspect,
          apiToken: token,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        // Replicate returns a `replicate.delivery` signed URL that expires
        // in ~24h. Inline the video into IndexedDB so it survives expiry
        // and across reloads.
        const persisted = await fetchToAsset(videoUrl, ctrl.signal).catch(() => videoUrl);
        if (ctrl.signal.aborted) return;
        if (!sectionVersionExists(section.id, activeVersion.id)) return;
        updateClipVersion(section.id, activeVersion.id, {
          output_url: persisted,
          still_ref: stillExists(section.id, stillToUse.id) ? stillToUse.id : undefined,
        });
        clearJob(jobKey);
      } catch (err) {
        if (isAbortError(err)) { clearJob(jobKey); return; }
        const message = err instanceof Error ? err.message : String(err);
        setJob(jobKey, { status: "error", error: message });
      } finally {
        endJob(jobKey);
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
      const token = providerKeys.runway!;
      const composedPrompt = composePromptWithBrief(
        activeVersion.motion.prompt,
        project.brief?.visual,
      );
      setJob(jobKey, { status: "running", startedAt: Date.now() });
      const ctrl = startJob(jobKey);
      try {
        const videoUrl = await runRunwayMotion({
          model: modelId,
          prompt: composedPrompt,
          // Runway accepts data URIs for promptImage; resolve local stills.
          firstFrameUrl: await resolveToApiDataUrl(stillToUse.output_url),
          durationSeconds: activeVersion.motion.duration_s || section.duration_s,
          aspect: project.aspect,
          apiToken: token,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        // Runway returns a short-lived signed URL — inline the bytes into
        // IndexedDB so the clip survives past expiry and across refresh.
        const persisted = await fetchToAsset(videoUrl, ctrl.signal).catch(() => videoUrl);
        if (ctrl.signal.aborted) return;
        if (!sectionVersionExists(section.id, activeVersion.id)) return;
        updateClipVersion(section.id, activeVersion.id, {
          output_url: persisted,
          still_ref: stillExists(section.id, stillToUse.id) ? stillToUse.id : undefined,
        });
        clearJob(jobKey);
      } catch (err) {
        if (isAbortError(err)) { clearJob(jobKey); return; }
        const message = err instanceof Error ? err.message : String(err);
        setJob(jobKey, { status: "error", error: message });
      } finally {
        endJob(jobKey);
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
    motionOutputUrl && /^(https?:|blob:|data:video)/.test(motionOutputUrl) ? motionOutputUrl : null;
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
          <button type="button" className="btn ghost" onClick={onClose}>
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
          onRemoveVersion={(id) => {
            const v = section.versions.find(v => v.id === id);
            if (!v) return;
            confirmAsk({
              title: `Delete version ${v.label}?`,
              message: "This cannot be undone.",
              confirm_label: "Delete",
              cancel_label: "Keep",
              destructive: true,
              onConfirm: () => removeTitleVersion(section.id, id),
            });
          }}
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
          onRemoveStill={(stillId) => {
            const still = section.stills.find(s => s.id === stillId);
            if (!still) return;
            confirmAsk({
              title: `Delete still ${still.label}?`,
              message: "This cannot be undone.",
              confirm_label: "Delete",
              cancel_label: "Keep",
              destructive: true,
              onConfirm: () => removeStill(section.id, stillId),
            });
          }}
          onSelectStill={(stillId) => setActiveStill(section.id, stillId)}
          onUpdateClipVersion={(versionId, patch) =>
            updateClipVersion(section.id, versionId, patch)
          }
          onAddClipVersion={() => addClipVersion(section.id)}
          onRemoveClipVersion={(versionId) => {
            const v = section.versions.find(v => v.id === versionId && v.kind === "clip");
            if (!v) return;
            confirmAsk({
              title: `Delete version ${v.label}?`,
              message: "This cannot be undone.",
              confirm_label: "Delete",
              cancel_label: "Keep",
              destructive: true,
              onConfirm: () => removeClipVersion(section.id, versionId),
            });
          }}
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
        <div className="stage-title"><span className="num">01</span><span className="stage-title-icon" aria-hidden>T</span>GRAPHIC</div>
        <Field label="Text">
          <textarea
            className="field-input tall"
            rows={3}
            value={titleVersion?.text ?? ""}
            disabled={!titleVersion}
            placeholder={titleVersion ? "Graphic text" : "+ new version to start"}
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
            placeholder={activeStill ? "" : "start typing — a still will be created"}
            onFocus={() => {
              if (!activeStill) onAddStill();
            }}
            onChange={(e) => {
              const value = e.target.value;
              if (activeStill) {
                onUpdateStill(activeStill.id, { image_prompt: value });
                return;
              }
              useStore.getState().addStill(section.id);
              const after = useStore
                .getState()
                .project.sections.find((s) => s.id === section.id);
              const newStill =
                after?.active_still_id
                  ? after.stills.find((s) => s.id === after.active_still_id)
                  : null;
              if (newStill) {
                useStore
                  .getState()
                  .updateStill(section.id, newStill.id, { image_prompt: value });
              }
            }}
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
                value={activeStill?.model ?? "pollinations"}
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
          {priorClipSections.length > 0 ? (
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
          ) : null}
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
          {stillJob?.status === "running" ? (
            <button
              type="button"
              className="btn ghost danger"
              onClick={() => activeStill && abortJob(stillJobKey(section.id, activeStill.id))}
            >
              ✕ Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={
                !activeStill
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
              {!activeStill
                ? "+ Add still first"
                : stillNeedsKey
                  ? `🔑 Add ${stillProviderName ?? "provider"} key`
                  : "✦ Generate still"}
            </button>
          )}
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
          {motionJob?.status === "running" ? (
            <button
              type="button"
              className="btn ghost danger"
              onClick={() => activeVersion && abortJob(motionJobKey(section.id, activeVersion.id))}
            >
              ✕ Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={!activeVersion}
              onClick={motionNeedsKey ? onOpenProviders : onGenerateMotion}
              title={
                motionNeedsKey
                  ? `Open Providers to add a ${motionProviderName ?? "provider"} key`
                  : undefined
              }
            >
              {motionNeedsKey
                ? `🔑 Add ${motionProviderName ?? "provider"} key`
                : "✦ Generate motion"}
            </button>
          )}
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

/* ───────────── COMMAND PALETTE ───────────── */


/* ───────────── HELP DIALOG ───────────── */

/* ───────────── PROVIDERS DIALOG ───────────── */

