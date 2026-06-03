"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Project } from "./types";

export type ProjectStub = {
  id: string;
  name: string;
  updated_at: string;
  duration_s: number;
  sections_count: number;
  aspect: string;
  thumbnail?: string;
};

export type ProjectLibraryState = {
  projects: Record<string, Project>;
  order: string[];
  saveProject: (project: Project) => void;
  loadProject: (id: string) => Project | null;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  duplicateProject: (id: string) => Project | null;
  list: () => ProjectStub[];
  has: (id: string) => boolean;
};

function newId(prefix: string): string {
  const u = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}_${u.slice(0, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stubFor(project: Project): ProjectStub {
  return {
    id: project.id,
    name: project.name,
    updated_at: project.updated_at,
    duration_s: project.duration_s,
    sections_count: project.sections.length,
    aspect: project.aspect,
  };
}

const STORAGE_KEY = "ai-cinema:project-library:v1";

export const useProjectLibrary = create<ProjectLibraryState>()(
  persist(
    (set, get) => ({
      projects: {},
      order: [],
      saveProject: (project) =>
        set((state) => {
          const next: Project = { ...project, updated_at: nowIso() };
          const order = state.order.includes(project.id)
            ? state.order
            : [project.id, ...state.order];
          return { projects: { ...state.projects, [project.id]: next }, order };
        }),
      loadProject: (id) => get().projects[id] ?? null,
      renameProject: (id, name) =>
        set((state) => {
          const p = state.projects[id];
          if (!p) return state;
          return {
            projects: { ...state.projects, [id]: { ...p, name, updated_at: nowIso() } },
          };
        }),
      deleteProject: (id) =>
        set((state) => {
          if (!state.projects[id]) return state;
          const projects = { ...state.projects };
          delete projects[id];
          return { projects, order: state.order.filter((x) => x !== id) };
        }),
      duplicateProject: (id) => {
        const src = get().projects[id];
        if (!src) return null;
        const copy: Project = {
          ...src,
          id: newId("project"),
          name: `${src.name} (copy)`,
          revision: 1,
          status: "draft",
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        set((state) => ({
          projects: { ...state.projects, [copy.id]: copy },
          order: [copy.id, ...state.order],
        }));
        return copy;
      },
      list: () => {
        const { projects, order } = get();
        return order.map((id) => projects[id]).filter(Boolean).map(stubFor);
      },
      has: (id) => !!get().projects[id],
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 1,
    },
  ),
);
