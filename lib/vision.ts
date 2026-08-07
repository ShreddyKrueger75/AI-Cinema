"use client";

// The "AI watches the video" half of the storyboard flow. Keyframes from the
// digest go to Claude, which writes each shot's description and the prompts
// that would regenerate it. Calls go browser-direct with the user's own key,
// same BYOM posture as the ElevenLabs and Replicate paths.

import Anthropic from "@anthropic-ai/sdk";
import type { Brief, Shot } from "./types";

export const VISION_MODEL = "claude-opus-5";

/** How many keyframes go into one request. */
const BATCH_SIZE = 12;

export type ShotDescription = {
  title: string;
  description: string;
  image_prompt: string;
  motion_prompt: string;
};

export type DescribeProgress = {
  done: number;
  total: number;
  message: string;
};

export type DescribeOptions = {
  shots: Shot[];
  apiKey: string;
  brief?: Brief;
  aspect?: string;
  onProgress?: (p: DescribeProgress) => void;
  signal?: AbortSignal;
};

const SHOT_SCHEMA = {
  type: "object",
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Two to four words naming the shot, e.g. 'Hero on desk' or 'Close on hands'.",
          },
          description: {
            type: "string",
            description:
              "One or two sentences describing what is actually visible in this frame — subject, framing, light, setting. Plain prose for a human reading the storyboard.",
          },
          image_prompt: {
            type: "string",
            description:
              "A still-image generation prompt that would recreate this frame: subject, composition, lens, lighting, palette. No camera movement.",
          },
          motion_prompt: {
            type: "string",
            description:
              "A short image-to-video motion prompt for this shot — the camera move or subject motion only, e.g. 'slow push in, subject turns toward camera'.",
          },
        },
        required: ["title", "description", "image_prompt", "motion_prompt"],
        additionalProperties: false,
      },
    },
  },
  required: ["shots"],
  additionalProperties: false,
} as const;

function briefText(brief?: Brief): string {
  if (!brief) return "";
  const parts = [
    brief.visual && `Visual: ${brief.visual}`,
    brief.lighting && `Lighting: ${brief.lighting}`,
    brief.camera && `Camera: ${brief.camera}`,
    brief.palette && `Palette: ${brief.palette}`,
    brief.subject && `Subject: ${brief.subject}`,
    brief.avoid && `Avoid: ${brief.avoid}`,
  ].filter(Boolean);
  if (parts.length === 0) return "";
  return [
    "",
    "The project has a house Brief. Write image_prompt and motion_prompt so a regenerated shot matches it, without contradicting what is actually in the frame:",
    ...parts.map((p) => `- ${p}`),
  ].join("\n");
}

const SYSTEM = `You are a shot-breakdown assistant for a video editor. You are shown consecutive keyframes from one video, in order, each labelled with its timecode.

For each keyframe, write:
- title: two to four words naming the shot
- description: one or two sentences on what is visibly in the frame
- image_prompt: a still-image generation prompt that would recreate the frame
- motion_prompt: a short image-to-video motion prompt — movement only

Describe only what you can see. Do not invent brand names, dialogue, or story beats that are not visible. If a frame is dark, blank, or a transition, say so plainly rather than inventing content.

Return exactly one entry per keyframe, in the order shown.`;

function dataUrlToBase64(dataUrl: string): { media_type: string; data: string } | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) return null;
  return { media_type: m[1], data: m[2] };
}

function timecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Describe every shot. Runs in batches so long videos stay under a sane
 * per-request size and the caller can show progress; each batch is told what
 * the previous batch produced so the read stays continuous.
 */
export async function describeShots(opts: DescribeOptions): Promise<ShotDescription[]> {
  const { shots, apiKey, brief, aspect, onProgress, signal } = opts;
  if (shots.length === 0) return [];

  const client = new Anthropic({
    apiKey,
    // The user's own key, entered in the Keys dialog and kept in their
    // browser — the same BYOM arrangement as every other provider here.
    dangerouslyAllowBrowser: true,
  });

  const out: ShotDescription[] = [];

  for (let start = 0; start < shots.length; start += BATCH_SIZE) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const batch = shots.slice(start, start + BATCH_SIZE);
    onProgress?.({
      done: start,
      total: shots.length,
      message: `Watching shots ${start + 1}–${start + batch.length} of ${shots.length}…`,
    });

    const content: Anthropic.ContentBlockParam[] = [];
    const priorTitles = out.slice(-3).map((d, i) => `${out.length - 3 + i + 1}. ${d.title}`);
    content.push({
      type: "text",
      text: [
        `Video: ${shots.length} shots total${aspect ? `, ${aspect}` : ""}. This request covers shots ${start + 1}–${start + batch.length}.`,
        priorTitles.length > 0
          ? `\nPreceding shots, for continuity:\n${priorTitles.join("\n")}`
          : "",
        briefText(brief),
      ]
        .filter(Boolean)
        .join("\n"),
    });

    for (let i = 0; i < batch.length; i++) {
      const img = dataUrlToBase64(batch[i].thumbnail);
      if (!img) continue;
      content.push({
        type: "text",
        text: `Shot ${start + i + 1} — ${timecode(batch[i].start_s)}, ${batch[i].duration_s.toFixed(1)}s`,
      });
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.media_type as "image/jpeg", data: img.data },
      });
    }

    const response = await client.messages.create(
      {
        model: VISION_MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: SHOT_SCHEMA },
        },
        messages: [{ role: "user", content }],
      },
      { signal },
    );

    if (response.stop_reason === "refusal") {
      throw new Error(
        `Claude declined to describe these frames${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}. You can still edit the storyboard by hand.`,
      );
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      throw new Error("Claude returned no description for this batch.");
    }

    let parsed: { shots?: ShotDescription[] };
    try {
      parsed = JSON.parse(text.text);
    } catch {
      throw new Error("Claude's response was not valid JSON.");
    }
    const got = Array.isArray(parsed.shots) ? parsed.shots : [];

    // Pad or trim so indices stay aligned with the shots we sent — a short
    // batch response must not shift every later card's text onto the wrong
    // thumbnail.
    for (let i = 0; i < batch.length; i++) {
      out.push(
        got[i] ?? {
          title: `Shot ${start + i + 1}`,
          description: "",
          image_prompt: "",
          motion_prompt: "",
        },
      );
    }
  }

  onProgress?.({ done: shots.length, total: shots.length, message: "Done watching." });
  return out;
}
