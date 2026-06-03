import type {
  Brief,
  ClipVersion,
  Grade,
  MusicTrack,
  Project,
  Section,
  Still,
  TitleStyle,
  Transition,
  VOSegment,
} from "./types";

export const DEFAULT_BRIEF: Brief = {
  id: "brief_warm_35mm_hero",
  name: "Warm 35mm Hero",
  visual:
    "warm 35mm hero, photoreal, golden hour, soft side light, shallow focus, cinematic photography, no logos, no text",
};

export const DEFAULT_GRADE: Grade = {
  id: "grade_warm_cinematic",
  name: "Warm Cinematic",
  adjustments: {
    exposure: 0.2,
    contrast: 18,
    mids: "warm",
    blacks: "crushed",
    shadow_tint: "teal",
  },
};

export const DEFAULT_TITLE_STYLE: TitleStyle = {
  id: "title_bfs_mono_bone",
  name: "BFS Mono — Bone",
  font: "JetBrains Mono Bold",
  color: "#f4f1ea",
  background_color: "#0a0908",
};

export const DEFAULT_MUSIC: MusicTrack = {
  id: "music_cinematic_build",
  name: "Cinematic Build",
  prompt: "slow cinematic build, low piano, distant strings, no drums",
  model: "elevenlabs-music",
};

const CLIP_DURATION_S = 3.0;

function buildSection03Detail(): Section {
  const stills: Still[] = [
    {
      id: "still_03_s1",
      label: "cool tone, tight crop",
      image_prompt: "macro detail, cool tone, tight crop",
      model: "pollinations",
      input_ref: null,
    },
    {
      id: "still_03_s2",
      label: "warm side light",
      image_prompt: "macro detail, raw stitching, warm side light, shallow focus",
      model: "pollinations",
      input_ref: "section:section_02:last_frame",
    },
  ];

  const versions: ClipVersion[] = [
    {
      id: "ver_03_v1",
      kind: "clip",
      label: "static — no motion",
      still_ref: "still_03_s2",
      motion: { prompt: "static, no motion", model: "ken-burns", duration_s: CLIP_DURATION_S },
    },
    {
      id: "ver_03_v2",
      kind: "clip",
      label: "orbit — too fast",
      still_ref: "still_03_s2",
      motion: {
        prompt: "fast orbit left to right, whip pan",
        model: "ken-burns",
        duration_s: CLIP_DURATION_S,
      },
    },
    {
      id: "ver_03_v3",
      kind: "clip",
      label: "slow orbit — keeper",
      still_ref: "still_03_s2",
      motion: {
        prompt: "slow orbit left to right, breathing focus pull, no whip",
        model: "ken-burns",
        duration_s: CLIP_DURATION_S,
      },
    },
  ];

  return {
    id: "section_03",
    index: 3,
    type: "clip",
    title: "Detail",
    duration_s: CLIP_DURATION_S,
    versions,
    active_version_id: "ver_03_v3",
    stills,
    active_still_id: "still_03_s2",
  };
}

function buildSimpleClipSection(args: {
  id: string;
  index: number;
  title: string;
  active_version_label?: string | null;
}): Section {
  const { id, index, title, active_version_label } = args;
  const versions: ClipVersion[] = active_version_label
    ? [
        {
          id: `ver_${id}_v1`,
          kind: "clip",
          label: active_version_label,
          still_ref: null,
          motion: { prompt: "", model: "ken-burns", duration_s: CLIP_DURATION_S },
        },
      ]
    : [];
  return {
    id,
    index,
    type: "clip",
    title,
    duration_s: CLIP_DURATION_S,
    versions,
    active_version_id: versions[0]?.id ?? null,
    stills: [],
    active_still_id: null,
  };
}

function buildTitleSection(args: { id: string; index: number; title: string; text: string }): Section {
  return {
    id: args.id,
    index: args.index,
    type: "title",
    title: args.title,
    duration_s: CLIP_DURATION_S,
    versions: [
      {
        id: `ver_${args.id}_v1`,
        kind: "title",
        label: "default style",
        text: args.text,
        style_ref: DEFAULT_TITLE_STYLE.id,
      },
    ],
    active_version_id: `ver_${args.id}_v1`,
    stills: [],
    active_still_id: null,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createDefaultProject(): Project {
  const sections: Section[] = [
    buildSimpleClipSection({ id: "section_01", index: 1, title: "Open", active_version_label: "open fade" }),
    buildSimpleClipSection({ id: "section_02", index: 2, title: "Reveal", active_version_label: "first take" }),
    buildSection03Detail(),
    buildSimpleClipSection({ id: "section_04", index: 4, title: "B-roll", active_version_label: "first take" }),
    buildTitleSection({ id: "section_05", index: 5, title: "Available Now", text: "Available Now" }),
    buildSimpleClipSection({ id: "section_06", index: 6, title: "CTA", active_version_label: null }),
  ];

  const transitions: Transition[] = [
    { id: "tr_01_02", from_section_id: "section_01", to_section_id: "section_02", type: "crossfade", duration_s: 0.4 },
    { id: "tr_02_03", from_section_id: "section_02", to_section_id: "section_03", type: "cut", duration_s: 0 },
    { id: "tr_03_04", from_section_id: "section_03", to_section_id: "section_04", type: "crossfade", duration_s: 0.4 },
    { id: "tr_04_05", from_section_id: "section_04", to_section_id: "section_05", type: "cut", duration_s: 0 },
    { id: "tr_05_06", from_section_id: "section_05", to_section_id: "section_06", type: "fade_black", duration_s: 0.4 },
  ];

  const vo_segments: VOSegment[] = [
    { id: "vo_01", text: "Meet the new standard.", voice: "default", start_s: 0, duration_s: 3 },
    { id: "vo_02", text: "Hand-stitched. Considered. Built to outlast you.", voice: "default", start_s: 6, duration_s: 6 },
  ];

  const created_at = nowIso();
  return {
    schema_version: 1,
    id: "project_seed",
    name: "Product Reveal",
    aspect: "9:16",
    duration_s: 18,
    status: "draft",
    revision: 3,
    sections,
    transitions,
    vo_segments,
    music_track: DEFAULT_MUSIC,
    grade: DEFAULT_GRADE,
    brief: DEFAULT_BRIEF,
    title_settings: DEFAULT_TITLE_STYLE,
    created_at,
    updated_at: created_at,
  };
}
