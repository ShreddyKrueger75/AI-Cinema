"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Brief, Grade, MusicTrack, TitleStyle } from "./types";

export type LibraryKind = "brief" | "grade" | "music" | "title";

export type LibraryItem<T> = {
  id: string;
  name: string;
  item: T;
  built_in?: boolean;
};

export type LibraryState = {
  briefs: LibraryItem<Brief>[];
  grades: LibraryItem<Grade>[];
  music: LibraryItem<MusicTrack>[];
  titles: LibraryItem<TitleStyle>[];

  saveBrief: (brief: Brief, name?: string) => string;
  saveGrade: (grade: Grade, name?: string) => string;
  saveMusic: (music: MusicTrack, name?: string) => string;
  saveTitle: (title: TitleStyle, name?: string) => string;

  renameItem: (kind: LibraryKind, id: string, name: string) => void;
  removeItem: (kind: LibraryKind, id: string) => void;
  resetToBuiltIns: () => void;
};

function newId(prefix: string): string {
  const u = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}_${u.slice(0, 8)}`;
}

const BUILT_IN_BRIEFS: LibraryItem<Brief>[] = [
  {
    id: "lib_brief_warm_35mm",
    name: "Warm 35mm Hero",
    built_in: true,
    item: {
      id: "brief_warm_35mm",
      name: "Warm 35mm Hero",
      visual: "warm 35mm hero, photoreal, golden hour, soft side light, shallow focus, cinematic photography, no logos, no text",
      lighting: "soft side light, golden hour",
      camera: "35mm, shallow focus",
      palette: "warm, golden",
      avoid: "no logos, no text",
    },
  },
  {
    id: "lib_brief_cool_anamorphic",
    name: "Cool Anamorphic",
    built_in: true,
    item: {
      id: "brief_cool_anamorphic",
      name: "Cool Anamorphic",
      visual: "anamorphic 2.39:1, cool blue-cyan tones, lens flares, hard backlight, neo-noir, cinematic photography",
      lighting: "hard backlight, neon spill",
      camera: "anamorphic, 50mm",
      palette: "blue, cyan, teal",
      avoid: "warm tones, vintage filters",
    },
  },
  {
    id: "lib_brief_studio_product",
    name: "Studio Product",
    built_in: true,
    item: {
      id: "brief_studio_product",
      name: "Studio Product",
      visual: "studio product photography, seamless background, controlled lighting, ultra detail, commercial-grade",
      lighting: "softbox, controlled, broad",
      camera: "macro, 100mm",
      palette: "neutral, hero color pop",
      avoid: "lens flares, motion blur",
    },
  },
  {
    id: "lib_brief_documentary_grain",
    name: "Documentary Grain",
    built_in: true,
    item: {
      id: "brief_doc_grain",
      name: "Documentary Grain",
      visual: "16mm film, visible grain, available light, candid framing, naturalistic, slightly desaturated",
      lighting: "available light",
      camera: "16mm, handheld",
      palette: "muted, naturalistic",
      avoid: "studio polish, perfection",
    },
  },
];

const BUILT_IN_GRADES: LibraryItem<Grade>[] = [
  {
    id: "lib_grade_warm_cinematic",
    name: "Warm Cinematic",
    built_in: true,
    item: {
      id: "grade_warm_cinematic",
      name: "Warm Cinematic",
      adjustments: {
        exposure: 0.2,
        contrast: 18,
        mids: "warm",
        blacks: "crushed",
        shadow_tint: "teal",
      },
    },
  },
  {
    id: "lib_grade_bleach_bypass",
    name: "Bleach Bypass",
    built_in: true,
    item: {
      id: "grade_bleach_bypass",
      name: "Bleach Bypass",
      adjustments: {
        exposure: 0.1,
        contrast: 32,
        mids: "neutral",
        blacks: "crushed",
        shadow_tint: "neutral",
      },
    },
  },
  {
    id: "lib_grade_teal_orange",
    name: "Teal & Orange",
    built_in: true,
    item: {
      id: "grade_teal_orange",
      name: "Teal & Orange",
      adjustments: {
        exposure: 0,
        contrast: 22,
        mids: "warm",
        blacks: "neutral",
        shadow_tint: "teal",
      },
    },
  },
  {
    id: "lib_grade_film_noir",
    name: "Film Noir",
    built_in: true,
    item: {
      id: "grade_noir",
      name: "Film Noir",
      adjustments: {
        exposure: -0.1,
        contrast: 38,
        mids: "cool",
        blacks: "crushed",
        shadow_tint: "violet",
      },
    },
  },
  {
    id: "lib_grade_neutral_natural",
    name: "Neutral Natural",
    built_in: true,
    item: {
      id: "grade_neutral",
      name: "Neutral Natural",
      adjustments: {
        exposure: 0,
        contrast: 8,
        mids: "neutral",
        blacks: "neutral",
        shadow_tint: "neutral",
      },
    },
  },
];

const BUILT_IN_MUSIC: LibraryItem<MusicTrack>[] = [
  {
    id: "lib_music_cinematic_build",
    name: "Cinematic Build",
    built_in: true,
    item: {
      id: "music_cinematic_build",
      name: "Cinematic Build",
      prompt: "slow cinematic build, low piano, distant strings, no drums",
      model: "elevenlabs-music",
    },
  },
  {
    id: "lib_music_modern_hero",
    name: "Modern Hero",
    built_in: true,
    item: {
      id: "music_modern_hero",
      name: "Modern Hero",
      prompt: "modern epic hero theme, pulsing synth, deep bass, anthemic drums",
      model: "elevenlabs-music",
    },
  },
  {
    id: "lib_music_lofi_drift",
    name: "Lo-Fi Drift",
    built_in: true,
    item: {
      id: "music_lofi_drift",
      name: "Lo-Fi Drift",
      prompt: "lo-fi atmospheric, dusty drums, mellow rhodes, gentle vinyl noise",
      model: "elevenlabs-music",
    },
  },
  {
    id: "lib_music_dark_pulse",
    name: "Dark Pulse",
    built_in: true,
    item: {
      id: "music_dark_pulse",
      name: "Dark Pulse",
      prompt: "neo-noir, dark synth pulse, sub bass, distant sirens, no melody",
      model: "stable-audio",
    },
  },
];

const BUILT_IN_TITLES: LibraryItem<TitleStyle>[] = [
  {
    id: "lib_title_bfs_mono_bone",
    name: "BFS Mono — Bone",
    built_in: true,
    item: {
      id: "title_bfs_mono_bone",
      name: "BFS Mono — Bone",
      font: "JetBrains Mono Bold",
      color: "#f4f1ea",
      background_color: "#0a0908",
    },
  },
  {
    id: "lib_title_blood_serif",
    name: "Blood Serif",
    built_in: true,
    item: {
      id: "title_blood_serif",
      name: "Blood Serif",
      font: "Playfair Display Black",
      color: "#e63a1c",
      background_color: "#0a0908",
    },
  },
  {
    id: "lib_title_clean_sans",
    name: "Clean Sans",
    built_in: true,
    item: {
      id: "title_clean_sans",
      name: "Clean Sans",
      font: "Inter Black",
      color: "#0a0908",
      background_color: "#f4f1ea",
    },
  },
  {
    id: "lib_title_neon_mono",
    name: "Neon Mono",
    built_in: true,
    item: {
      id: "title_neon_mono",
      name: "Neon Mono",
      font: "JetBrains Mono Bold",
      color: "#6dd47e",
      background_color: "#0a0908",
    },
  },
];

const STORAGE_KEY = "ai-cinema:library:v1";

export const useLibrary = create<LibraryState>()(
  persist(
    (set) => ({
      briefs: BUILT_IN_BRIEFS,
      grades: BUILT_IN_GRADES,
      music: BUILT_IN_MUSIC,
      titles: BUILT_IN_TITLES,

      saveBrief: (brief, name) => {
        const id = newId("lib_brief");
        const entry: LibraryItem<Brief> = { id, name: name ?? brief.name, item: { ...brief } };
        set((state) => ({ briefs: [...state.briefs, entry] }));
        return id;
      },
      saveGrade: (grade, name) => {
        const id = newId("lib_grade");
        const entry: LibraryItem<Grade> = { id, name: name ?? grade.name, item: { ...grade } };
        set((state) => ({ grades: [...state.grades, entry] }));
        return id;
      },
      saveMusic: (music, name) => {
        const id = newId("lib_music");
        const entry: LibraryItem<MusicTrack> = { id, name: name ?? music.name, item: { ...music } };
        set((state) => ({ music: [...state.music, entry] }));
        return id;
      },
      saveTitle: (title, name) => {
        const id = newId("lib_title");
        const entry: LibraryItem<TitleStyle> = { id, name: name ?? title.name, item: { ...title } };
        set((state) => ({ titles: [...state.titles, entry] }));
        return id;
      },

      renameItem: (kind, id, name) =>
        set((state) => {
          if (kind === "brief")
            return { briefs: state.briefs.map((b) => (b.id === id ? { ...b, name } : b)) };
          if (kind === "grade")
            return { grades: state.grades.map((g) => (g.id === id ? { ...g, name } : g)) };
          if (kind === "music")
            return { music: state.music.map((m) => (m.id === id ? { ...m, name } : m)) };
          return { titles: state.titles.map((t) => (t.id === id ? { ...t, name } : t)) };
        }),

      removeItem: (kind, id) =>
        set((state) => {
          if (kind === "brief")
            return {
              briefs: state.briefs.filter((b) => b.id !== id || b.built_in),
            };
          if (kind === "grade")
            return {
              grades: state.grades.filter((g) => g.id !== id || g.built_in),
            };
          if (kind === "music")
            return { music: state.music.filter((m) => m.id !== id || m.built_in) };
          return { titles: state.titles.filter((t) => t.id !== id || t.built_in) };
        }),

      resetToBuiltIns: () =>
        set({
          briefs: BUILT_IN_BRIEFS,
          grades: BUILT_IN_GRADES,
          music: BUILT_IN_MUSIC,
          titles: BUILT_IN_TITLES,
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 1,
    },
  ),
);
