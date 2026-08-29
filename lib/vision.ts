"use client";

// The "AI watches the video" half of the storyboard flow. Keyframes from the
// digest go to Claude, which writes each shot's description and the prompts
// that would regenerate it. Calls go browser-direct with the user's own key,
// same BYOM posture as the ElevenLabs and Replicate paths.
//
// Real keys fail in real ways — rate limits, oversized requests, overloads,
// dropped connections — so batches retry with backoff, halve themselves when
// too big, and a run that still dies throws DescribeError carrying every shot
// described so far instead of losing the lot.

import Anthropic from "@anthropic-ai/sdk";
import type { Brief, Shot } from "./types";

export const VISION_MODEL = "claude-opus-5";

/** How many keyframes go into one request. */
const BATCH_SIZE = 12;

// The SDK already retries twice internally with short waits; this outer layer
// adds a few slower retries on top before giving up on a batch.
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60_000;

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

/**
 * Thrown when a run dies partway through. `partial` holds every shot already
 * described, in order; `failedAtIndex` is the first shot index not covered by
 * it (always `partial.length`). Aborts are not wrapped — they surface as a
 * DOMException "AbortError".
 */
export class DescribeError extends Error {
  partial: ShotDescription[];
  failedAtIndex: number;

  constructor(message: string, partial: ShotDescription[], failedAtIndex: number, cause?: unknown) {
    super(message, { cause });
    this.name = "DescribeError";
    this.partial = partial;
    this.failedAtIndex = failedAtIndex;
  }
}

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

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    err instanceof Anthropic.APIUserAbortError ||
    (err instanceof DOMException && err.name === "AbortError")
  );
}

/** 429 / 5xx / connection drop — worth waiting out and trying again. */
function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return false;
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  return err instanceof Anthropic.APIError && typeof err.status === "number" && err.status >= 500;
}

/** 413 / request_too_large — resending the same payload can never succeed. */
function isTooLarge(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  return err.status === 413 || (err.type as string | null) === "request_too_large";
}

/** The server's Retry-After, in ms, when the SDK surfaced one on the error. */
function retryAfterMs(err: unknown): number | null {
  if (!(err instanceof Anthropic.APIError)) return null;
  const header = err.headers?.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function backoffMs(retry: number, err: unknown): number {
  const jittered = BASE_DELAY_MS * 2 ** retry * (0.5 + Math.random() * 0.5);
  return Math.min(Math.max(jittered, retryAfterMs(err) ?? 0), MAX_DELAY_MS);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function placeholder(index: number): ShotDescription {
  return { title: `Shot ${index + 1}`, description: "", image_prompt: "", motion_prompt: "" };
}

type RunContext = {
  client: Anthropic;
  total: number;
  brief: Brief | undefined;
  aspect: string | undefined;
  signal: AbortSignal | undefined;
  /** Descriptions so far, appended strictly in shot order. */
  out: ShotDescription[];
};

function batchContent(ctx: RunContext, batch: Shot[], startIndex: number): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = [];
  const prior = ctx.out.slice(-3);
  const priorTitles = prior.map((d, i) => `${ctx.out.length - prior.length + i + 1}. ${d.title}`);
  content.push({
    type: "text",
    text: [
      `Video: ${ctx.total} shots total${ctx.aspect ? `, ${ctx.aspect}` : ""}. This request covers shots ${startIndex + 1}–${startIndex + batch.length}.`,
      priorTitles.length > 0
        ? `\nPreceding shots, for continuity:\n${priorTitles.join("\n")}`
        : "",
      briefText(ctx.brief),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  for (let i = 0; i < batch.length; i++) {
    const img = dataUrlToBase64(batch[i].thumbnail);
    if (!img) continue;
    content.push({
      type: "text",
      text: `Shot ${startIndex + i + 1} — ${timecode(batch[i].start_s)}, ${batch[i].duration_s.toFixed(1)}s`,
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.media_type as "image/jpeg", data: img.data },
    });
  }
  return content;
}

/**
 * One request. Returns the parsed shot list, or null when the response was
 * malformed (no text block, bad JSON, or no shots array) — the caller decides
 * whether to re-request. Throws on refusal and on API/network errors.
 */
async function callBatch(
  ctx: RunContext,
  content: Anthropic.ContentBlockParam[],
): Promise<ShotDescription[] | null> {
  const response = await ctx.client.messages.create(
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
    { signal: ctx.signal },
  );

  if (response.stop_reason === "refusal") {
    throw new Error(
      `Claude declined to describe these frames${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}. You can still edit the storyboard by hand.`,
    );
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  try {
    const parsed: { shots?: ShotDescription[] } = JSON.parse(text.text);
    return Array.isArray(parsed.shots) ? parsed.shots : null;
  } catch {
    return null;
  }
}

/** Halve a failing batch and take the halves sequentially, in order. */
async function splitAndDescribe(ctx: RunContext, batch: Shot[], startIndex: number): Promise<void> {
  const mid = Math.ceil(batch.length / 2);
  await describeBatch(ctx, batch.slice(0, mid), startIndex);
  await describeBatch(ctx, batch.slice(mid), startIndex + mid);
}

/**
 * Describe one batch, appending exactly batch.length entries to ctx.out.
 * Transient failures back off and retry; an oversized batch (or one still
 * rate-limited after backoff) is halved recursively down to single images; a
 * single image that is itself too large, or a batch that stays malformed
 * after one re-request, gets placeholders so the run continues. Throws only
 * when the run genuinely cannot continue.
 */
async function describeBatch(ctx: RunContext, batch: Shot[], startIndex: number): Promise<void> {
  if (batch.length === 0) return;
  const content = batchContent(ctx, batch, startIndex);
  let retries = 0;
  let sawMalformed = false;

  for (;;) {
    if (ctx.signal?.aborted) throw abortError();
    try {
      const got = await callBatch(ctx, content);
      if (got === null) {
        // One immediate re-request for a garbled response; a second garble
        // costs this batch its text, not the whole run.
        if (sawMalformed) {
          for (let i = 0; i < batch.length; i++) ctx.out.push(placeholder(startIndex + i));
          return;
        }
        sawMalformed = true;
        continue;
      }
      // Pad or trim so indices stay aligned with the shots we sent — a short
      // batch response must not shift every later card's text onto the wrong
      // thumbnail.
      for (let i = 0; i < batch.length; i++) {
        ctx.out.push(got[i] ?? placeholder(startIndex + i));
      }
      return;
    } catch (err) {
      if (isAbort(err, ctx.signal)) throw abortError();
      if (isTooLarge(err)) {
        if (batch.length === 1) {
          // This keyframe is oversized all on its own; fail just this shot.
          ctx.out.push(placeholder(startIndex));
          return;
        }
        return splitAndDescribe(ctx, batch, startIndex);
      }
      if (isRetryable(err)) {
        if (retries < MAX_RETRIES) {
          await sleep(backoffMs(retries, err), ctx.signal);
          retries += 1;
          continue;
        }
        // Backoff alone didn't clear the rate limit — a smaller request
        // might, before we give up on the run.
        if (err instanceof Anthropic.RateLimitError && batch.length > 1) {
          return splitAndDescribe(ctx, batch, startIndex);
        }
      }
      throw err;
    }
  }
}

/**
 * Describe every shot. Runs in batches so long videos stay under a sane
 * per-request size and the caller can show progress; each batch is told what
 * the previous batch produced so the read stays continuous.
 *
 * Resolves with exactly one description per shot, in order. On unrecoverable
 * mid-run failure, throws DescribeError carrying the partial results; on
 * abort, throws a DOMException "AbortError".
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

  const ctx: RunContext = { client, total: shots.length, brief, aspect, signal, out: [] };

  for (let start = 0; start < shots.length; start += BATCH_SIZE) {
    if (signal?.aborted) throw abortError();
    const batch = shots.slice(start, start + BATCH_SIZE);
    onProgress?.({
      done: start,
      total: shots.length,
      message: `Watching shots ${start + 1}–${start + batch.length} of ${shots.length}…`,
    });

    try {
      await describeBatch(ctx, batch, start);
    } catch (err) {
      if (isAbort(err, signal)) throw abortError();
      const reason = err instanceof Error ? err.message : String(err);
      throw new DescribeError(
        `Described ${ctx.out.length} of ${shots.length} shots, then stopped: ${reason}`,
        ctx.out,
        ctx.out.length,
        err,
      );
    }
  }

  onProgress?.({ done: shots.length, total: shots.length, message: "Done watching." });
  return ctx.out;
}
