"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { selectActiveSection, useStore } from "@/lib/store";
import type { Aspect, VOSegment } from "@/lib/types";
import { downloadProjectJSON, pickProjectJSONFile } from "@/lib/serialize";
import { useProviderKeys } from "@/lib/providers";
import { recordModelSpend, useCosts } from "@/lib/costs";
import { useLibrary } from "@/lib/library";
import { useProjectLibrary } from "@/lib/projects";
import { useHistory } from "@/lib/history";
import { toast } from "@/lib/toast";
import { StoryboardDialog } from "./storyboard-dialog";
import { confirmAsk, useConfirm } from "@/lib/confirm";
import {
  isReplicateMusicModel,
  runReplicateMusic,
  fetchAsDataUrl,
} from "@/lib/replicate";
import { runElevenLabsMusic, runElevenLabsTTS } from "@/lib/elevenlabs";
import {
  downloadCubeLUT,
  measureAudioDuration,
  projectHasGeneratedContent,
} from "@/components/lib";
import { StatusBar } from "@/components/status-bar";
import { ConfirmViewport, ToastViewport } from "@/components/viewports";
import { MobileViewer } from "@/components/mobile-viewer";
import { PreviewAudio, PreviewStage } from "@/components/preview-stage";
import { VOSegmentEditor } from "@/components/vo";
import { MusicEditor } from "@/components/look-editors";
import { CommandPalette, HelpDialog, ProvidersDialog } from "@/components/dialogs";
import { RenderDialog } from "@/components/render-dialog";
import { FlowPanel } from "@/components/flow-panel";
import { Timeline } from "@/components/timeline";
import { WelcomeBanner } from "@/components/welcome-banner";
import { ProjectHeader } from "@/components/project-header";
import { ProjectSettings } from "@/components/project-settings";
import { LibraryRail } from "@/components/library-rail";
import { Footer } from "@/components/footer";

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
  const duplicateSection = useStore((s) => s.duplicateSection);
  const resetProject = useStore((s) => s.resetProject);
  const updateVOSegment = useStore((s) => s.updateVOSegment);
  const removeVOSegment = useStore((s) => s.removeVOSegment);
  const updateBrief = useStore((s) => s.updateBrief);
  const updateGrade = useStore((s) => s.updateGrade);
  const setGrade = useStore((s) => s.setGrade);
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
      Promise.resolve(useCosts.persist.rehydrate()),
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

  // Under 900px the editor gives way to the read-only viewer. Gate it in JS
  // (not just CSS) so its thumbnail <img>s never load on desktop.
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    const update = () => setIsNarrowViewport(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const saveProjectToLibrary = useProjectLibrary((s) => s.saveProject);
  const loadProjectFromLibrary = useProjectLibrary((s) => s.loadProject);
  const renameProjectInLibrary = useProjectLibrary((s) => s.renameProject);
  const deleteProjectFromLibrary = useProjectLibrary((s) => s.deleteProject);
  const duplicateProjectInLibrary = useProjectLibrary((s) => s.duplicateProject);

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [editingVOId, setEditingVOId] = useState<string | null>(null);
  const [musicPanelOpen, setMusicPanelOpen] = useState(false);
  const [lookOpen, setLookOpen] = useState<null | "brief" | "grade" | "title">(null);
  const [renderOpen, setRenderOpen] = useState(false);
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
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
        recordModelSpend("elevenlabs-music", project.duration_s / 60);
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
        recordModelSpend("elevenlabs-tts", seg.text.length / 1000);
        // Measure the actual audio duration so the segment's window on the
        // timeline matches the generated speech — the 3s default can chop a
        // longer line, and a fully-fit window lets one VO span multiple clips.
        const measured = await measureAudioDuration(dataUrl).catch(() => null);
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

  const currentPreviewIndex = useMemo(() => {
    if (playPosition !== null) return playPosition;
    const i = project.sections.findIndex((s) => s.id === activeSectionId);
    return i >= 0 ? i : 0;
  }, [playPosition, activeSectionId, project.sections]);

  const previewStartSeconds = useMemo(
    () => project.sections.slice(0, currentPreviewIndex).reduce((acc, s) => acc + s.duration_s, 0),
    [project.sections, currentPreviewIndex],
  );


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
        if (storyboardOpen) { setStoryboardOpen(false); return; }
        if (providersOpen) { setProvidersOpen(false); return; }
        if (musicPanelOpen) { setMusicPanelOpen(false); return; }
        if (editingVOId) { setEditingVOId(null); return; }
        if (lookOpen) { setLookOpen(null); return; }
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
    storyboardOpen,
    providersOpen,
    musicPanelOpen,
    editingVOId,
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


  const clipsCount = project.sections.length;
  const totalCols = Math.max(1, clipsCount);

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
      {isNarrowViewport ? <MobileViewer project={project} /> : null}

      <div className="workspace">
      <StatusBar
        hydrated={hydrated}
        onOpenProviders={() => setProvidersOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />

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
        <WelcomeBanner
          onDismiss={dismissWelcome}
          onOpenProviders={() => setProvidersOpen(true)}
        />
      ) : null}

      <ProjectHeader
        isPlaying={playPosition !== null}
        onRequestAspectChange={requestAspectChange}
        onOpenStoryboard={() => setStoryboardOpen(true)}
        onImport={handleImport}
        onExport={handleExport}
        onTogglePreview={togglePreview}
        onOpenRender={() => setRenderOpen(true)}
      />

      <ProjectSettings
        lookOpen={lookOpen}
        setLookOpen={setLookOpen}
        onRequestAspectChange={requestAspectChange}
        currentIndex={currentPreviewIndex}
        startSeconds={previewStartSeconds}
        isPlaying={playPosition !== null}
        onTogglePlay={togglePreview}
        onStop={stopPreview}
      />

      <PreviewStage
        project={project}
        currentIndex={currentPreviewIndex}
        startSeconds={previewStartSeconds}
        isPlaying={playPosition !== null}
        onTogglePlay={togglePreview}
      />

      <Timeline
        isPlaying={playPosition !== null}
        playheadSeconds={playheadSeconds}
        previewSectionId={previewSectionId}
        editingVOId={editingVOId}
        setEditingVOId={setEditingVOId}
        onOpenMusicPanel={() => setMusicPanelOpen(true)}
        onOpenGradePanel={() => setLookOpen("grade")}
      />

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
                onRemove={() => { removeVOSegment(seg.id); setEditingVOId(null); }}
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

      {storyboardOpen ? (
        <StoryboardDialog
          project={project}
          anthropicKey={providerKeys.anthropic?.trim() || null}
          onApply={setProject}
          onClose={() => setStoryboardOpen(false)}
          onOpenKeys={() => setProvidersOpen(true)}
        />
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

      <LibraryRail />

      <Footer />
      </div>

      <PreviewAudio
        isPlaying={playPosition !== null}
        playheadSeconds={playheadSeconds}
        musicUrl={project.music_track?.output_url ?? null}
        voSegments={project.vo_segments}
      />
      <ToastViewport />
      <ConfirmViewport />
    </>
  );
}
