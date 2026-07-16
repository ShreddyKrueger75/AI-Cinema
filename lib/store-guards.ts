"use client";

import { useStore } from "./store";
import type { Project, Section } from "./types";

export function sectionVersionExists(sectionId: string, versionId: string): boolean {
  const sec = useStore.getState().project.sections.find((s) => s.id === sectionId);
  return !!sec && sec.versions.some((v) => v.id === versionId);
}

export function stillExists(sectionId: string, stillId: string): boolean {
  const sec = useStore.getState().project.sections.find((s) => s.id === sectionId);
  return !!sec && sec.stills.some((st) => st.id === stillId);
}

export function voSegmentExists(segId: string): boolean {
  return useStore.getState().project.vo_segments.some((v) => v.id === segId);
}

export function musicSegmentExists(segId: string): boolean {
  return (useStore.getState().project.music_segments ?? []).some((m) => m.id === segId);
}

export function projectHasGeneratedContent(project: Project): boolean {
  return project.sections.some(
    (s) =>
      s.stills.some((st) => !!st.output_url) ||
      s.versions.some((v) => v.kind === "clip" && !!v.output_url),
  );
}

export function sectionHasImportedContent(section: Section): boolean {
  const v = section.versions.find((x) => x.id === section.active_version_id);
  if (v && v.kind === "clip" && v.output_url && /^(blob:|data:)/.test(v.output_url)) return true;
  const stillId = v && v.kind === "clip" ? v.still_ref ?? section.active_still_id : section.active_still_id;
  const still = stillId ? section.stills.find((s) => s.id === stillId) : null;
  if (still?.output_url && /^(blob:|data:)/.test(still.output_url)) return true;
  return false;
}
