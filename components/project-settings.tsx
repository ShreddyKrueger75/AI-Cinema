"use client";

import { useStore } from "@/lib/store";
import { useLibrary } from "@/lib/library";
import type { Aspect, Project } from "@/lib/types";
import { ASPECT_OPTIONS } from "@/components/lib";
import { BriefEditor, GradeEditor, LookSlot } from "@/components/look-editors";
import { StageControls } from "@/components/preview-stage";

export type LookOpen = null | "brief" | "grade" | "title";

export function ProjectSettings({
  lookOpen,
  setLookOpen,
  onRequestAspectChange,
  currentIndex,
  startSeconds,
  isPlaying,
  onTogglePlay,
  onStop,
}: {
  lookOpen: LookOpen;
  setLookOpen: (next: LookOpen) => void;
  onRequestAspectChange: (next: Aspect) => void;
  currentIndex: number;
  startSeconds: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
}) {
  const project: Project = useStore((s) => s.project);
  const updateBrief = useStore((s) => s.updateBrief);
  const updateGrade = useStore((s) => s.updateGrade);
  const setGrade = useStore((s) => s.setGrade);

  const libraryBriefs = useLibrary((s) => s.briefs);
  const libraryGrades = useLibrary((s) => s.grades);
  const saveBriefToLibrary = useLibrary((s) => s.saveBrief);
  const saveGradeToLibrary = useLibrary((s) => s.saveGrade);
  const removeLibraryItem = useLibrary((s) => s.removeItem);
  const renameLibraryItem = useLibrary((s) => s.renameItem);

  return (
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
            onClick={() => onRequestAspectChange(a)}
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
      <StageControls
        project={project}
        currentIndex={currentIndex}
        startSeconds={startSeconds}
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        onStop={onStop}
      />
    </div>
  );
}
