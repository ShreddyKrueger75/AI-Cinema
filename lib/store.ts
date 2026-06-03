"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Project, Section } from "./types";
import { createDefaultProject } from "./defaults";

export type StoreState = {
  project: Project;
  activeSectionId: string | null;
  setProject: (project: Project) => void;
  resetProject: () => void;
  setActiveSection: (id: string | null) => void;
  setActiveVersion: (sectionId: string, versionId: string) => void;
  setActiveStill: (sectionId: string, stillId: string) => void;
};

const STORAGE_KEY = "ai-cinema:project:v1";

function touch(project: Project): Project {
  return { ...project, revision: project.revision + 1, updated_at: new Date().toISOString() };
}

function mapSection(project: Project, sectionId: string, fn: (s: Section) => Section): Project {
  return touch({
    ...project,
    sections: project.sections.map((s) => (s.id === sectionId ? fn(s) : s)),
  });
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
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 1,
    },
  ),
);

export function selectActiveSection(state: StoreState): Section | null {
  if (!state.activeSectionId) return null;
  return state.project.sections.find((s) => s.id === state.activeSectionId) ?? null;
}
