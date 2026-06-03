"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ClipVersion, Project, Section, Still } from "./types";
import { createDefaultProject } from "./defaults";

export type StoreState = {
  project: Project;
  activeSectionId: string | null;
  setProject: (project: Project) => void;
  resetProject: () => void;
  setActiveSection: (id: string | null) => void;
  setActiveVersion: (sectionId: string, versionId: string) => void;
  setActiveStill: (sectionId: string, stillId: string) => void;
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

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      project: createDefaultProject(),
      activeSectionId: "section_03",

      setProject: (project) => set({ project: touch(project) }),

      resetProject: () => set({ project: createDefaultProject(), activeSectionId: "section_03" }),

      setActiveSection: (id) => set({ activeSectionId: id }),

      setActiveVersion: (sectionId, versionId) =>
        set((state) => ({
          project: mapSection(state.project, sectionId, (s) => ({ ...s, active_version_id: versionId })),
        })),

      setActiveStill: (sectionId, stillId) =>
        set((state) => ({
          project: mapSection(state.project, sectionId, (s) => ({ ...s, active_still_id: stillId })),
        })),

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
