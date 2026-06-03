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
import { DEFAULT_BRIEF, DEFAULT_GRADE, DEFAULT_MUSIC, DEFAULT_TITLE_STYLE } from "./defaults";

export type Template = {
  id: string;
  name: string;
  description: string;
  build: () => Project;
};

function newId(prefix: string): string {
  const u = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}_${u.slice(0, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clipSection(opts: {
  index: number;
  title: string;
  prompt: string;
  motion?: string;
  duration_s?: number;
}): Section {
  const id = newId("section");
  const stillId = newId("still");
  const versionId = newId("ver");
  const duration_s = opts.duration_s ?? 3;
  const still: Still = {
    id: stillId,
    label: opts.prompt,
    image_prompt: opts.prompt,
    model: "pollinations",
    input_ref: null,
  };
  const version: ClipVersion = {
    id: versionId,
    kind: "clip",
    label: "v1",
    still_ref: stillId,
    motion: { prompt: opts.motion ?? "subtle camera drift", model: "ken-burns", duration_s },
  };
  return {
    id,
    index: opts.index,
    type: "clip",
    title: opts.title,
    duration_s,
    stills: [still],
    active_still_id: stillId,
    versions: [version],
    active_version_id: versionId,
  };
}

function titleSection(opts: { index: number; title: string; text: string; duration_s?: number }): Section {
  const id = newId("section");
  const versionId = newId("ver");
  const duration_s = opts.duration_s ?? 3;
  return {
    id,
    index: opts.index,
    type: "title",
    title: opts.title,
    duration_s,
    stills: [],
    active_still_id: null,
    versions: [
      {
        id: versionId,
        kind: "title",
        label: "v1",
        text: opts.text,
        style_ref: null,
      },
    ],
    active_version_id: versionId,
  };
}

function transitionsFor(sectionIds: string[], type: Transition["type"] = "crossfade"): Transition[] {
  const out: Transition[] = [];
  for (let i = 0; i < sectionIds.length - 1; i++) {
    out.push({
      id: newId("tr"),
      from_section_id: sectionIds[i],
      to_section_id: sectionIds[i + 1],
      type,
      duration_s: type === "cut" ? 0 : 0.4,
    });
  }
  return out;
}

function totalDuration(sections: Section[]): number {
  return sections.reduce((a, s) => a + s.duration_s, 0);
}

function withBrief(brief: Brief, name: string): Brief {
  return { ...brief, id: newId("brief"), name };
}
function withGrade(grade: Grade, name: string): Grade {
  return { ...grade, id: newId("grade"), name };
}
function withMusic(music: MusicTrack, name: string): MusicTrack {
  return { ...music, id: newId("music"), name };
}
function withTitleStyle(title: TitleStyle, name: string): TitleStyle {
  return { ...title, id: newId("titlestyle"), name };
}

function baseProject(opts: {
  name: string;
  sections: Section[];
  vo?: VOSegment[];
  brief?: Brief;
  grade?: Grade;
  music?: MusicTrack;
  title_settings?: TitleStyle;
  aspect?: "9:16" | "16:9" | "1:1";
}): Project {
  const created_at = nowIso();
  const sections = opts.sections.map((s, i) => ({ ...s, index: i + 1 }));
  return {
    schema_version: 1,
    id: newId("project"),
    name: opts.name,
    aspect: opts.aspect ?? "9:16",
    duration_s: totalDuration(sections),
    status: "draft",
    revision: 1,
    sections,
    transitions: transitionsFor(sections.map((s) => s.id)),
    vo_segments: opts.vo ?? [],
    music_track: opts.music ?? DEFAULT_MUSIC,
    grade: opts.grade ?? DEFAULT_GRADE,
    brief: opts.brief ?? DEFAULT_BRIEF,
    title_settings: opts.title_settings ?? DEFAULT_TITLE_STYLE,
    created_at,
    updated_at: created_at,
  };
}

export const TEMPLATES: Template[] = [
  {
    id: "tpl_blank",
    name: "Blank canvas",
    description: "One empty clip. Start from nothing.",
    build: () =>
      baseProject({
        name: "Untitled",
        sections: [clipSection({ index: 1, title: "Open", prompt: "", motion: "" })],
      }),
  },
  {
    id: "tpl_product_reveal",
    name: "Product Reveal",
    description: "6 × 3s vertical hero spot. Open → Reveal → Detail → B-roll → Title → CTA.",
    build: () => {
      const sections = [
        clipSection({
          index: 1,
          title: "Open",
          prompt: "hero product in soft golden hour light, mysterious silhouette, shallow focus",
          motion: "slow push in, breathing focus pull",
        }),
        clipSection({
          index: 2,
          title: "Reveal",
          prompt: "hero product full reveal, warm side light, photoreal detail",
          motion: "subtle pull back, anchor reveal",
        }),
        clipSection({
          index: 3,
          title: "Detail",
          prompt: "macro detail, raw stitching, warm side light, shallow focus",
          motion: "slow orbit left to right, breathing focus pull",
        }),
        clipSection({
          index: 4,
          title: "B-roll",
          prompt: "lifestyle context, hero product in hand, environmental, candid",
          motion: "subtle handheld drift",
        }),
        titleSection({ index: 5, title: "Available Now", text: "Available Now" }),
        clipSection({
          index: 6,
          title: "CTA",
          prompt: "hero product against bone-on-black backdrop, logo space lower third",
          motion: "static, no motion",
        }),
      ];
      return baseProject({
        name: "Product Reveal",
        sections,
        vo: [
          { id: newId("vo"), text: "Meet the new standard.", voice: "default", start_s: 0, duration_s: 3 },
          {
            id: newId("vo"),
            text: "Hand-stitched. Considered. Built to outlast you.",
            voice: "default",
            start_s: 6,
            duration_s: 6,
          },
        ],
      });
    },
  },
  {
    id: "tpl_title_card",
    name: "Title card only",
    description: "Single 5s title. For drops, cuts, or section breaks.",
    build: () =>
      baseProject({
        name: "Title Card",
        aspect: "9:16",
        sections: [titleSection({ index: 1, title: "Title", text: "Coming Soon", duration_s: 5 })],
      }),
  },
  {
    id: "tpl_tutorial_3shot",
    name: "Tutorial — 3 shot",
    description: "Intro + Demo + Outro · 16:9 · 5s each.",
    build: () =>
      baseProject({
        name: "Tutorial",
        aspect: "16:9",
        sections: [
          clipSection({
            index: 1,
            title: "Intro",
            prompt: "instructor at desk, clean studio lighting, looking at camera, neutral colors",
            motion: "slow push in",
            duration_s: 5,
          }),
          clipSection({
            index: 2,
            title: "Demo",
            prompt: "screen recording style, clean UI, focused detail, editorial framing",
            motion: "subtle drift, focus pull",
            duration_s: 5,
          }),
          clipSection({
            index: 3,
            title: "Outro",
            prompt: "instructor returns, smile, slight wide reveal of workspace",
            motion: "wide reveal pull back",
            duration_s: 5,
          }),
        ],
        brief: withBrief(
          {
            id: "brief_studio_natural",
            name: "Studio Natural",
            visual: "clean studio lighting, naturalistic colors, editorial framing, no logos",
            lighting: "soft key, clean fill",
            camera: "50mm, mid framing",
            palette: "neutral, slight warmth",
          },
          "Studio Natural",
        ),
      }),
  },
  {
    id: "tpl_dark_drop",
    name: "Dark drop",
    description: "Noir teaser · 4 × 4s · Bleach Bypass grade · neo-noir music.",
    build: () =>
      baseProject({
        name: "Dark Drop",
        sections: [
          clipSection({
            index: 1,
            title: "Establish",
            prompt: "rain-slick city street at night, neon reflections, anamorphic frame, neo-noir",
            motion: "slow dolly forward, low angle",
            duration_s: 4,
          }),
          clipSection({
            index: 2,
            title: "Approach",
            prompt: "silhouette walking under sodium streetlight, hard backlight, smoke",
            motion: "tracking shot, parallax",
            duration_s: 4,
          }),
          titleSection({ index: 3, title: "Drop", text: "12.12", duration_s: 3 }),
          clipSection({
            index: 4,
            title: "Logo",
            prompt: "logomark on dark background, single rim light, minimal, restrained",
            motion: "static, slight breathing focus",
            duration_s: 3,
          }),
        ],
        brief: withBrief(
          {
            id: "brief_neonoir",
            name: "Neo-Noir",
            visual:
              "anamorphic 2.39:1, cool blue-cyan tones, lens flares, hard backlight, neo-noir, cinematic photography",
            lighting: "hard backlight, neon spill",
            camera: "anamorphic 50mm",
            palette: "blue, cyan, teal",
            avoid: "warm tones, vintage filters",
          },
          "Neo-Noir",
        ),
        grade: withGrade(
          {
            id: "grade_noir_pulse",
            name: "Noir Pulse",
            adjustments: {
              exposure: -0.1,
              contrast: 38,
              mids: "cool",
              blacks: "crushed",
              shadow_tint: "violet",
            },
          },
          "Noir Pulse",
        ),
        music: withMusic(
          {
            id: "music_noir_pulse",
            name: "Dark Pulse",
            prompt: "neo-noir, dark synth pulse, sub bass, distant sirens, no melody",
            model: "stable-audio",
          },
          "Dark Pulse",
        ),
        title_settings: withTitleStyle(
          {
            id: "title_neon_mono",
            name: "Neon Mono",
            font: "JetBrains Mono Bold",
            color: "#6dd47e",
            background_color: "#0a0908",
          },
          "Neon Mono",
        ),
      }),
  },
];
