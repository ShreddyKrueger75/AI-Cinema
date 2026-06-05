import type {
  Brief,
  ClipVersion,
  GraphicOverlay,
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
  graphics?: GraphicOverlay[];
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
    graphics: opts.graphics ?? [],
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
    description: "6 × 3s vertical hero spot. Open → Reveal → Detail → B-roll → CTA. Title as graphic overlay.",
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
        clipSection({
          index: 5,
          title: "Hero hold",
          prompt: "hero product backlit, bone-on-black backdrop, hero hold for title",
          motion: "static, slow breathing focus",
        }),
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
        graphics: [
          {
            id: newId("graphic"),
            label: "Available Now",
            text: "Available Now",
            start_s: 12,
            duration_s: 3,
            position: "center",
          },
        ],
      });
    },
  },
  {
    id: "tpl_social_story",
    name: "Social Story (9:16)",
    description: "5 × 3s vertical hook for Instagram/TikTok stories. Hook → tease → reveal → proof → CTA.",
    build: () =>
      baseProject({
        name: "Social Story",
        aspect: "9:16",
        sections: [
          clipSection({
            index: 1,
            title: "Hook",
            prompt: "punchy hero subject, bold composition, eye-catching, vertical framing",
            motion: "quick push in",
          }),
          clipSection({
            index: 2,
            title: "Tease",
            prompt: "intriguing detail, partial reveal, creates curiosity, soft focus background",
            motion: "slow drift right",
          }),
          clipSection({
            index: 3,
            title: "Reveal",
            prompt: "full subject reveal, hero moment, sharp focus, vibrant",
            motion: "pull back to wide",
          }),
          clipSection({
            index: 4,
            title: "Proof",
            prompt: "lifestyle context, user enjoying product, authentic candid moment",
            motion: "handheld drift",
          }),
          clipSection({
            index: 5,
            title: "CTA",
            prompt: "clean background, branded space, call to action area",
            motion: "static",
          }),
        ],
        graphics: [
          {
            id: newId("graphic"),
            label: "Swipe Up",
            text: "↑ Tap to learn more",
            start_s: 12,
            duration_s: 3,
            position: "bottom",
          },
        ],
      }),
  },
  {
    id: "tpl_youtube_preroll",
    name: "YouTube Pre-Roll (16:9)",
    description: "6s skippable ad. Hook in 2s, message in 3s, brand close. 3 × 2s.",
    build: () =>
      baseProject({
        name: "YouTube Pre-Roll",
        aspect: "16:9",
        sections: [
          clipSection({
            index: 1,
            title: "Hook",
            prompt: "attention-grabbing visual, surprising or beautiful, lands in first second",
            motion: "fast push in, snap focus",
            duration_s: 2,
          }),
          clipSection({
            index: 2,
            title: "Message",
            prompt: "clear product or service in use, single benefit communicated visually",
            motion: "smooth tracking shot",
            duration_s: 2,
          }),
          clipSection({
            index: 3,
            title: "Brand",
            prompt: "logo on brand-colored background, clean composition, lower third space",
            motion: "static, slight breathing",
            duration_s: 2,
          }),
        ],
        vo: [
          { id: newId("vo"), text: "Discover the difference.", voice: "default", start_s: 2, duration_s: 2 },
        ],
        graphics: [
          {
            id: newId("graphic"),
            label: "Learn more",
            text: "Learn more →",
            start_s: 4,
            duration_s: 2,
            position: "bottom",
          },
        ],
      }),
  },
  {
    id: "tpl_tutorial_3shot",
    name: "Tutorial — 3 shot (16:9)",
    description: "Intro + Demo + Outro · 16:9 · 5s each. Clean studio look.",
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
        graphics: [
          {
            id: newId("graphic"),
            label: "Subscribe",
            text: "Subscribe for more",
            start_s: 12,
            duration_s: 3,
            position: "bottom",
          },
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
    id: "tpl_brand_anthem",
    name: "Brand Anthem (16:9)",
    description: "Cinematic 30s brand spot. 6 × 5s. Big emotional arc with VO and graphic close.",
    build: () =>
      baseProject({
        name: "Brand Anthem",
        aspect: "16:9",
        sections: [
          clipSection({
            index: 1,
            title: "Establish",
            prompt: "sweeping wide establishing shot, golden hour, epic cinematic landscape",
            motion: "slow aerial push forward",
            duration_s: 5,
          }),
          clipSection({
            index: 2,
            title: "Human",
            prompt: "intimate portrait of person at work, focused, dignified, natural light",
            motion: "slow dolly side",
            duration_s: 5,
          }),
          clipSection({
            index: 3,
            title: "Craft",
            prompt: "close-up of hands creating, tactile detail, shallow focus, warm tones",
            motion: "smooth rack focus",
            duration_s: 5,
          }),
          clipSection({
            index: 4,
            title: "Process",
            prompt: "mid-shot of tools in action, motion blur on hands, atmospheric",
            motion: "subtle handheld energy",
            duration_s: 5,
          }),
          clipSection({
            index: 5,
            title: "Result",
            prompt: "finished work revealed, hero composition, triumphant lighting",
            motion: "slow pull back to wide",
            duration_s: 5,
          }),
          clipSection({
            index: 6,
            title: "Brand mark",
            prompt: "brand logo on cinematic backdrop, lower-third space, restrained",
            motion: "static, slow breathing",
            duration_s: 5,
          }),
        ],
        vo: [
          { id: newId("vo"), text: "Some things take time.", voice: "default", start_s: 0, duration_s: 4 },
          { id: newId("vo"), text: "Made by hand. Made to last.", voice: "default", start_s: 10, duration_s: 5 },
          { id: newId("vo"), text: "The standard you remember.", voice: "default", start_s: 20, duration_s: 5 },
        ],
        graphics: [
          {
            id: newId("graphic"),
            label: "Tagline",
            text: "Built for what comes next.",
            start_s: 25,
            duration_s: 5,
            position: "center",
          },
        ],
      }),
  },
  {
    id: "tpl_logo_reveal",
    name: "Logo Reveal (1:1)",
    description: "Dramatic 5s logo moment. Backdrop clip → brand mark with graphic.",
    build: () =>
      baseProject({
        name: "Logo Reveal",
        aspect: "1:1",
        sections: [
          clipSection({
            index: 1,
            title: "Backdrop",
            prompt: "cinematic dark backdrop, single rim light, atmospheric haze, restrained",
            motion: "slow push in, breathing focus",
            duration_s: 5,
          }),
        ],
        graphics: [
          {
            id: newId("graphic"),
            label: "Logo",
            text: "BRAND",
            start_s: 1.5,
            duration_s: 3.5,
            position: "center",
          },
        ],
        title_settings: withTitleStyle(
          {
            id: "title_clean_serif",
            name: "Clean Serif",
            font: "Playfair Display Black",
            color: "#f4f1ea",
            background_color: "#0a0908",
          },
          "Clean Serif",
        ),
      }),
  },
];
