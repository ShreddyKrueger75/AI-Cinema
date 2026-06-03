"use client";

import { create } from "zustand";

export type GenStatus = "idle" | "running" | "error";

export type GenSlot = {
  status: GenStatus;
  error?: string;
  startedAt?: number;
};

export type GenStateState = {
  jobs: Record<string, GenSlot>;
  setJob: (key: string, slot: GenSlot) => void;
  clearJob: (key: string) => void;
};

export const useGenState = create<GenStateState>((set) => ({
  jobs: {},
  setJob: (key, slot) =>
    set((state) => ({ jobs: { ...state.jobs, [key]: slot } })),
  clearJob: (key) =>
    set((state) => {
      const next = { ...state.jobs };
      delete next[key];
      return { jobs: next };
    }),
}));

export function stillJobKey(sectionId: string, stillId: string): string {
  return `still:${sectionId}:${stillId}`;
}

export function motionJobKey(sectionId: string, versionId: string): string {
  return `motion:${sectionId}:${versionId}`;
}
