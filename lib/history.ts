"use client";

import { create } from "zustand";
import type { Project } from "./types";

const MAX_HISTORY = 60;

export type HistoryState = {
  past: Project[];
  future: Project[];
  push: (snapshot: Project) => void;
  undo: (current: Project) => Project | null;
  redo: (current: Project) => Project | null;
  clear: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
};

export const useHistory = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  push: (snapshot) =>
    set((state) => ({
      past: [...state.past, snapshot].slice(-MAX_HISTORY),
      future: [],
    })),
  undo: (current) => {
    const { past } = get();
    if (past.length === 0) return null;
    const previous = past[past.length - 1];
    set((state) => ({
      past: state.past.slice(0, -1),
      future: [current, ...state.future].slice(0, MAX_HISTORY),
    }));
    return previous;
  },
  redo: (current) => {
    const { future } = get();
    if (future.length === 0) return null;
    const next = future[0];
    set((state) => ({
      past: [...state.past, current].slice(-MAX_HISTORY),
      future: state.future.slice(1),
    }));
    return next;
  },
  clear: () => set({ past: [], future: [] }),
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
