"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { useProjectLibrary } from "@/lib/projects";
import type { Aspect } from "@/lib/types";
import { ASPECT_OPTIONS } from "@/components/lib";
import { InlineText, Popover } from "@/components/ui";

export function ProjectHeader({
  isPlaying,
  onRequestAspectChange,
  onOpenStoryboard,
  onImport,
  onExport,
  onTogglePreview,
  onOpenRender,
}: {
  isPlaying: boolean;
  onRequestAspectChange: (next: Aspect) => void;
  onOpenStoryboard: () => void;
  onImport: () => void;
  onExport: () => void;
  onTogglePreview: () => void;
  onOpenRender: () => void;
}) {
  const project = useStore((s) => s.project);
  const updateProjectMeta = useStore((s) => s.updateProjectMeta);
  const savedProjectsMap = useProjectLibrary((s) => s.projects);
  const savedRecord = savedProjectsMap[project.id];
  const isDirty = !savedRecord || savedRecord.updated_at !== project.updated_at;
  const isInLibrary = !!savedRecord;

  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);

  const clipsCount = project.sections.length;

  return (
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
                    onRequestAspectChange(a);
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
        <button
          type="button"
          className="btn ghost"
          onClick={onOpenStoryboard}
          title="Drop a video — AI watches it and builds an editable storyboard"
          aria-label="Open Video to Storyboard"
        >
          ▦ Storyboard
        </button>
        <button type="button" className="btn ghost" onClick={onImport} title="Import a project JSON" aria-label="Import project JSON">⇧ Import</button>
        <button type="button" className="btn ghost" onClick={onExport} title="Export the project as JSON" aria-label="Export project JSON">⇩ Export</button>
        <button
          type="button"
          className={`btn ${isPlaying ? "primary" : ""}`}
          onClick={onTogglePreview}
          title="Walk through each section for its duration (Space)"
          aria-label={isPlaying ? "Stop preview playback" : "Play preview playback"}
        >
          {isPlaying ? "■ Stop" : "▶ Preview"}
        </button>
        <button type="button" className="btn primary" onClick={onOpenRender} aria-label="Open Render to MP4 dialog">⤓ Render MP4</button>
      </div>
    </div>
  );
}
