"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { useProjectLibrary } from "@/lib/projects";
import { TEMPLATES } from "@/lib/templates";
import { toast } from "@/lib/toast";
import { confirmAsk } from "@/lib/confirm";
import { templateIcon } from "@/components/lib";

export function LibraryRail() {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const projectOrder = useProjectLibrary((s) => s.order);
  const savedProjectsMap = useProjectLibrary((s) => s.projects);
  const projectStubs = useMemo(
    () => projectOrder.map((id) => savedProjectsMap[id]).filter(Boolean),
    [projectOrder, savedProjectsMap],
  );
  const isInLibrary = !!savedProjectsMap[project.id];
  const saveProjectToLibrary = useProjectLibrary((s) => s.saveProject);
  const loadProjectFromLibrary = useProjectLibrary((s) => s.loadProject);

  return (
      <aside className="workspace-library">
        <div className="lib-head"><span className="lib-tab-icon" aria-hidden>⊞</span> // LIBRARY</div>
        <div className="lib-body">
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
        </div>
      </aside>
  );
}
