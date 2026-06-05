"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Aspect,
  Brief,
  ClipVersion,
  GraphicOverlay,
  Grade,
  MusicTrack,
  Project,
  Section,
  Still,
  TitleStyle,
  TitleVersion,
  Transition,
  TransitionType,
  VOSegment,
} from "./types";
import { createDefaultProject } from "./defaults";

export type StoreState = {
  project: Project;
  activeSectionId: string | null;
  setProject: (project: Project) => void;
  resetProject: () => void;

  updateProjectMeta: (patch: { name?: string; aspect?: Aspect }) => void;

  setActiveSection: (id: string | null) => void;
  setActiveVersion: (sectionId: string, versionId: string) => void;
  setActiveStill: (sectionId: string, stillId: string) => void;

  updateSection: (sectionId: string, patch: { title?: string; duration_s?: number; notes?: string }) => void;
  addClipSection: (afterSectionId?: string | null) => void;
  addTitleSection: (afterSectionId?: string | null) => void;
  removeSection: (sectionId: string) => void;
  moveSection: (sectionId: string, direction: -1 | 1) => void;
  moveSectionTo: (sectionId: string, targetSectionId: string, position: "before" | "after") => void;
  duplicateSection: (sectionId: string) => void;

  updateStill: (sectionId: string, stillId: string, patch: Partial<Omit<Still, "id">>) => void;
  addStill: (sectionId: string) => void;
  removeStill: (sectionId: string, stillId: string) => void;

  updateClipVersion: (
    sectionId: string,
    versionId: string,
    patch: {
      label?: string;
      motion?: Partial<ClipVersion["motion"]>;
      still_ref?: string | null;
      output_url?: string;
    },
  ) => void;
  addClipVersion: (sectionId: string) => void;
  removeClipVersion: (sectionId: string, versionId: string) => void;

  updateTitleVersion: (
    sectionId: string,
    versionId: string,
    patch: { label?: string; text?: string; style_ref?: string | null; output_url?: string },
  ) => void;
  addTitleVersion: (sectionId: string) => void;
  removeTitleVersion: (sectionId: string, versionId: string) => void;

  updateTransition: (transitionId: string, patch: { type?: TransitionType; duration_s?: number }) => void;

  updateBrief: (patch: Partial<Omit<Brief, "id">>) => void;
  updateGrade: (patch: Partial<Omit<Grade, "id">>) => void;
  updateMusic: (patch: Partial<Omit<MusicTrack, "id">>) => void;
  updateTitleStyle: (patch: Partial<Omit<TitleStyle, "id">>) => void;

  addVOSegment: () => void;
  updateVOSegment: (id: string, patch: Partial<Omit<VOSegment, "id">>) => void;
  removeVOSegment: (id: string) => void;

  addGraphic: (atSeconds?: number) => void;
  updateGraphic: (id: string, patch: Partial<Omit<GraphicOverlay, "id">>) => void;
  removeGraphic: (id: string) => void;
};

const STORAGE_KEY = "ai-cinema:project:v1";

function touch(project: Project): Project {
  return { ...project, updated_at: new Date().toISOString() };
}

function mapSection(project: Project, sectionId: string, fn: (s: Section) => Section): Project {
  return touch({
    ...project,
    sections: project.sections.map((s) => (s.id === sectionId ? fn(s) : s)),
  });
}

function newId(prefix: string): string {
  const u = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}_${u.slice(0, 8)}`;
}

function reindexAndRetotal(project: Project): Project {
  const sections = project.sections.map((s, i) => ({ ...s, index: i + 1 }));
  const duration_s = sections.reduce((acc, s) => acc + s.duration_s, 0);
  const vo_segments = project.vo_segments
    .map((v) => {
      const start_s = Math.min(v.start_s, Math.max(0, duration_s - 0.5));
      const duration_s_clamped = Math.min(v.duration_s, Math.max(0.5, duration_s - start_s));
      return { ...v, start_s, duration_s: duration_s_clamped };
    })
    .filter((v) => v.duration_s >= 0.5 && v.start_s < duration_s);
  return { ...project, sections, duration_s, vo_segments };
}

function reconcileTransitions(project: Project): Project {
  const ids = project.sections.map((s) => s.id);
  const wanted: Transition[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const from = ids[i];
    const to = ids[i + 1];
    const existing = project.transitions.find(
      (t) => t.from_section_id === from && t.to_section_id === to,
    );
    if (existing) {
      wanted.push(existing);
    } else {
      wanted.push({
        id: newId("tr"),
        from_section_id: from,
        to_section_id: to,
        type: "crossfade",
        duration_s: 0.4,
      });
    }
  }
  return { ...project, transitions: wanted };
}

function buildClipSection(index: number): Section {
  const id = newId("section");
  const stillId = newId("still");
  const versionId = newId("ver");
  return {
    id,
    index,
    type: "clip",
    title: "New clip",
    duration_s: 3,
    stills: [
      { id: stillId, label: "still 1", image_prompt: "", model: "pollinations", input_ref: null },
    ],
    active_still_id: stillId,
    versions: [
      {
        id: versionId,
        kind: "clip",
        label: "v1",
        still_ref: stillId,
        motion: { prompt: "", model: "ken-burns", duration_s: 3 },
      },
    ],
    active_version_id: versionId,
  };
}

function buildTitleSection(index: number): Section {
  const id = newId("section");
  const versionId = newId("ver");
  return {
    id,
    index,
    type: "title",
    title: "New title",
    duration_s: 3,
    stills: [],
    active_still_id: null,
    versions: [
      {
        id: versionId,
        kind: "title",
        label: "v1",
        text: "Title text",
        style_ref: null,
      },
    ],
    active_version_id: versionId,
  };
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      project: createDefaultProject(),
      activeSectionId: "section_03",

      setProject: (project) => set({ project: touch(project) }),

      resetProject: () => set({ project: createDefaultProject(), activeSectionId: "section_03" }),

      updateProjectMeta: (patch) =>
        set((state) => ({
          project: touch({
            ...state.project,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.aspect !== undefined ? { aspect: patch.aspect } : {}),
          }),
        })),

      setActiveSection: (id) => set({ activeSectionId: id }),

      setActiveVersion: (sectionId, versionId) =>
        set((state) => ({
          project: mapSection(state.project, sectionId, (s) => ({ ...s, active_version_id: versionId })),
        })),

      setActiveStill: (sectionId, stillId) =>
        set((state) => ({
          project: mapSection(state.project, sectionId, (s) => ({ ...s, active_still_id: stillId })),
        })),

      updateSection: (sectionId, patch) =>
        set((state) => {
          let next = mapSection(state.project, sectionId, (s) => ({
            ...s,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.duration_s !== undefined ? { duration_s: patch.duration_s } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          }));
          if (patch.duration_s !== undefined) {
            next = reindexAndRetotal(next);
          }
          return { project: next };
        }),

      addClipSection: (afterSectionId) =>
        set((state) => {
          const sections = [...state.project.sections];
          const insertAt =
            afterSectionId == null
              ? sections.length
              : Math.max(0, sections.findIndex((s) => s.id === afterSectionId) + 1);
          const section = buildClipSection(insertAt + 1);
          sections.splice(insertAt, 0, section);
          let next = reindexAndRetotal({ ...state.project, sections });
          next = reconcileTransitions(next);
          return { project: touch(next), activeSectionId: section.id };
        }),

      addTitleSection: (afterSectionId) =>
        set((state) => {
          const sections = [...state.project.sections];
          const insertAt =
            afterSectionId == null
              ? sections.length
              : Math.max(0, sections.findIndex((s) => s.id === afterSectionId) + 1);
          const section = buildTitleSection(insertAt + 1);
          sections.splice(insertAt, 0, section);
          let next = reindexAndRetotal({ ...state.project, sections });
          next = reconcileTransitions(next);
          return { project: touch(next), activeSectionId: section.id };
        }),

      removeSection: (sectionId) =>
        set((state) => {
          const sections = state.project.sections.filter((s) => s.id !== sectionId);
          if (sections.length === 0) return state;
          let next = reindexAndRetotal({ ...state.project, sections });
          next = reconcileTransitions(next);
          const nextActive =
            state.activeSectionId === sectionId ? sections[0]?.id ?? null : state.activeSectionId;
          return { project: touch(next), activeSectionId: nextActive };
        }),

      moveSection: (sectionId, direction) =>
        set((state) => {
          const sections = [...state.project.sections];
          const i = sections.findIndex((s) => s.id === sectionId);
          const j = i + direction;
          if (i < 0 || j < 0 || j >= sections.length) return state;
          [sections[i], sections[j]] = [sections[j], sections[i]];
          let next = reindexAndRetotal({ ...state.project, sections });
          next = reconcileTransitions(next);
          return { project: touch(next) };
        }),

      moveSectionTo: (sectionId, targetSectionId, position) =>
        set((state) => {
          if (sectionId === targetSectionId) return state;
          const sections = [...state.project.sections];
          const fromIdx = sections.findIndex((s) => s.id === sectionId);
          if (fromIdx < 0) return state;
          const [moved] = sections.splice(fromIdx, 1);
          let toIdx = sections.findIndex((s) => s.id === targetSectionId);
          if (toIdx < 0) return state;
          if (position === "after") toIdx += 1;
          sections.splice(toIdx, 0, moved);
          let next = reindexAndRetotal({ ...state.project, sections });
          next = reconcileTransitions(next);
          return { project: touch(next) };
        }),

      duplicateSection: (sectionId) =>
        set((state) => {
          const sections = [...state.project.sections];
          const i = sections.findIndex((s) => s.id === sectionId);
          if (i < 0) return state;
          const src = sections[i];
          const stillIdMap = new Map<string, string>();
          const newStills: Still[] = src.stills.map((st) => {
            const newId_ = newId("still");
            stillIdMap.set(st.id, newId_);
            return { ...st, id: newId_ };
          });
          const newVersions = src.versions.map((v) => {
            if (v.kind === "clip") {
              const remapped = v.still_ref ? stillIdMap.get(v.still_ref) ?? null : null;
              return { ...v, id: newId("ver"), still_ref: remapped };
            }
            return { ...v, id: newId("ver") };
          });
          const activeVersionId =
            newVersions[src.versions.findIndex((v) => v.id === src.active_version_id)]?.id ??
            newVersions[0]?.id ??
            null;
          const activeStillId = src.active_still_id ? stillIdMap.get(src.active_still_id) ?? null : null;
          const copy: Section = {
            ...src,
            id: newId("section"),
            index: 0,
            title: `${src.title} (copy)`,
            stills: newStills,
            versions: newVersions,
            active_version_id: activeVersionId,
            active_still_id: activeStillId,
          };
          sections.splice(i + 1, 0, copy);
          let next = reindexAndRetotal({ ...state.project, sections });
          next = reconcileTransitions(next);
          return { project: touch(next), activeSectionId: copy.id };
        }),

      updateStill: (sectionId, stillId, patch) =>
        set((state) => ({
          project: mapSection(state.project, sectionId, (s) => ({
            ...s,
            stills: s.stills.map((st) => (st.id === stillId ? { ...st, ...patch } : st)),
          })),
        })),

      addStill: (sectionId) =>
        set((state) => {
          const section = state.project.sections.find((s) => s.id === sectionId);
          if (!section) return state;
          const seed = section.stills.find((s) => s.id === section.active_still_id);
          const still: Still = {
            id: newId("still"),
            label: "new still",
            image_prompt: "",
            model: seed?.model ?? "pollinations",
            input_ref: null,
          };
          return {
            project: mapSection(state.project, sectionId, (s) => ({
              ...s,
              stills: [...s.stills, still],
              active_still_id: still.id,
            })),
          };
        }),

      removeStill: (sectionId, stillId) =>
        set((state) => ({
          project: mapSection(state.project, sectionId, (s) => {
            const next = s.stills.filter((st) => st.id !== stillId);
            const refDeleted = s.active_still_id === stillId;
            return {
              ...s,
              stills: next,
              active_still_id: refDeleted ? (next[0]?.id ?? null) : s.active_still_id,
              versions: s.versions.map((v) =>
                v.kind === "clip" && v.still_ref === stillId ? { ...v, still_ref: null } : v,
              ),
            };
          }),
        })),

      updateClipVersion: (sectionId, versionId, patch) =>
        set((state) => ({
          project: mapSection(state.project, sectionId, (s) => ({
            ...s,
            versions: s.versions.map((v) => {
              if (v.id !== versionId || v.kind !== "clip") return v;
              return {
                ...v,
                ...(patch.label !== undefined ? { label: patch.label } : {}),
                ...(patch.still_ref !== undefined ? { still_ref: patch.still_ref } : {}),
                ...(patch.output_url !== undefined ? { output_url: patch.output_url } : {}),
                ...(patch.motion ? { motion: { ...v.motion, ...patch.motion } } : {}),
              };
            }),
          })),
        })),

      addClipVersion: (sectionId) =>
        set((state) => {
          const section = state.project.sections.find((s) => s.id === sectionId);
          if (!section || section.type !== "clip") return state;
          const seed = section.versions.find((v) => v.id === section.active_version_id);
          const seedMotion = seed && seed.kind === "clip" ? seed.motion : null;
          const version: ClipVersion = {
            id: newId("ver"),
            kind: "clip",
            label: "new version",
            still_ref: section.active_still_id,
            motion: {
              prompt: seedMotion?.prompt ?? "",
              model: seedMotion?.model ?? "ken-burns",
              duration_s: seedMotion?.duration_s ?? section.duration_s,
            },
          };
          return {
            project: mapSection(state.project, sectionId, (s) => ({
              ...s,
              versions: [...s.versions, version],
              active_version_id: version.id,
            })),
          };
        }),

      removeClipVersion: (sectionId, versionId) =>
        set((state) => ({
          project: mapSection(state.project, sectionId, (s) => {
            const next = s.versions.filter((v) => v.id !== versionId);
            const refDeleted = s.active_version_id === versionId;
            return {
              ...s,
              versions: next,
              active_version_id: refDeleted ? (next[0]?.id ?? null) : s.active_version_id,
            };
          }),
        })),

      updateTitleVersion: (sectionId, versionId, patch) =>
        set((state) => ({
          project: mapSection(state.project, sectionId, (s) => ({
            ...s,
            versions: s.versions.map((v) => {
              if (v.id !== versionId || v.kind !== "title") return v;
              return {
                ...v,
                ...(patch.label !== undefined ? { label: patch.label } : {}),
                ...(patch.text !== undefined ? { text: patch.text } : {}),
                ...(patch.style_ref !== undefined ? { style_ref: patch.style_ref } : {}),
                ...(patch.output_url !== undefined ? { output_url: patch.output_url } : {}),
              };
            }),
          })),
        })),

      addTitleVersion: (sectionId) =>
        set((state) => {
          const section = state.project.sections.find((s) => s.id === sectionId);
          if (!section || section.type !== "title") return state;
          const seed = section.versions.find((v) => v.id === section.active_version_id);
          const seedT = seed && seed.kind === "title" ? seed : null;
          const version: TitleVersion = {
            id: newId("ver"),
            kind: "title",
            label: "new version",
            text: seedT?.text ?? "Title text",
            style_ref: seedT?.style_ref ?? null,
          };
          return {
            project: mapSection(state.project, sectionId, (s) => ({
              ...s,
              versions: [...s.versions, version],
              active_version_id: version.id,
            })),
          };
        }),

      removeTitleVersion: (sectionId, versionId) =>
        set((state) => ({
          project: mapSection(state.project, sectionId, (s) => {
            const next = s.versions.filter((v) => v.id !== versionId);
            const refDeleted = s.active_version_id === versionId;
            return {
              ...s,
              versions: next,
              active_version_id: refDeleted ? (next[0]?.id ?? null) : s.active_version_id,
            };
          }),
        })),

      updateTransition: (transitionId, patch) =>
        set((state) => ({
          project: touch({
            ...state.project,
            transitions: state.project.transitions.map((t) =>
              t.id === transitionId
                ? {
                    ...t,
                    ...(patch.type !== undefined ? { type: patch.type } : {}),
                    ...(patch.duration_s !== undefined ? { duration_s: patch.duration_s } : {}),
                  }
                : t,
            ),
          }),
        })),

      updateBrief: (patch) =>
        set((state) => {
          const current = state.project.brief ?? {
            id: newId("brief"),
            name: "Untitled brief",
            visual: "",
          };
          return {
            project: touch({
              ...state.project,
              brief: { ...current, ...patch },
            }),
          };
        }),

      updateGrade: (patch) =>
        set((state) => {
          const current = state.project.grade ?? {
            id: newId("grade"),
            name: "Untitled grade",
            adjustments: {},
          };
          return {
            project: touch({
              ...state.project,
              grade: {
                ...current,
                ...patch,
                ...(patch.adjustments
                  ? { adjustments: { ...current.adjustments, ...patch.adjustments } }
                  : {}),
              },
            }),
          };
        }),

      updateMusic: (patch) =>
        set((state) => {
          const current = state.project.music_track ?? {
            id: newId("music"),
            name: "Untitled music",
            prompt: "",
            model: "elevenlabs-music",
          };
          return {
            project: touch({
              ...state.project,
              music_track: { ...current, ...patch },
            }),
          };
        }),

      updateTitleStyle: (patch) =>
        set((state) => {
          const current = state.project.title_settings ?? {
            id: newId("titlestyle"),
            name: "Untitled title style",
            font: "JetBrains Mono Bold",
            color: "#f4f1ea",
            background_color: "#0a0908",
          };
          return {
            project: touch({
              ...state.project,
              title_settings: { ...current, ...patch },
            }),
          };
        }),

      addVOSegment: () =>
        set((state) => {
          const last = state.project.vo_segments[state.project.vo_segments.length - 1];
          const start_s = last ? Math.min(state.project.duration_s, last.start_s + last.duration_s) : 0;
          const remaining = Math.max(1, state.project.duration_s - start_s);
          const seg: VOSegment = {
            id: newId("vo"),
            text: "New line",
            voice: "default",
            start_s,
            duration_s: Math.min(3, remaining),
          };
          return {
            project: touch({
              ...state.project,
              vo_segments: [...state.project.vo_segments, seg],
            }),
          };
        }),

      updateVOSegment: (id, patch) =>
        set((state) => ({
          project: touch({
            ...state.project,
            vo_segments: state.project.vo_segments.map((v) => (v.id === id ? { ...v, ...patch } : v)),
          }),
        })),

      removeVOSegment: (id) =>
        set((state) => ({
          project: touch({
            ...state.project,
            vo_segments: state.project.vo_segments.filter((v) => v.id !== id),
          }),
        })),

      addGraphic: (atSeconds) =>
        set((state) => {
          const total = state.project.duration_s;
          const start_s = Math.max(
            0,
            Math.min(total - 0.5, atSeconds ?? 0),
          );
          const duration_s = Math.min(2, Math.max(0.5, total - start_s));
          const existing = state.project.graphics ?? [];
          const overlay: GraphicOverlay = {
            id: newId("graphic"),
            label: `Graphic ${existing.length + 1}`,
            text: "TITLE",
            start_s,
            duration_s,
            style_ref: null,
            position: "center",
          };
          return {
            project: touch({
              ...state.project,
              graphics: [...existing, overlay],
            }),
          };
        }),

      updateGraphic: (id, patch) =>
        set((state) => ({
          project: touch({
            ...state.project,
            graphics: (state.project.graphics ?? []).map((g) =>
              g.id === id ? { ...g, ...patch } : g,
            ),
          }),
        })),

      removeGraphic: (id) =>
        set((state) => ({
          project: touch({
            ...state.project,
            graphics: (state.project.graphics ?? []).filter((g) => g.id !== id),
          }),
        })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 2,
    },
  ),
);

export function selectActiveSection(state: StoreState): Section | null {
  if (!state.activeSectionId) return null;
  return state.project.sections.find((s) => s.id === state.activeSectionId) ?? null;
}
