import type { Aspect } from "./types";

const BASE = "https://api.replicate.com/v1";

type PredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

type Prediction = {
  id: string;
  status: PredictionStatus;
  output: unknown;
  error: string | null;
  urls?: { get?: string; cancel?: string };
};

export type ReplicateImageModel = "flux-1.1-pro" | "flux-schnell" | "sdxl" | "ideogram-v2";

const IMAGE_MODEL_SLUGS: Record<ReplicateImageModel, string> = {
  "flux-1.1-pro": "black-forest-labs/flux-1.1-pro",
  "flux-schnell": "black-forest-labs/flux-schnell",
  "sdxl": "stability-ai/sdxl",
  "ideogram-v2": "ideogram-ai/ideogram-v2",
};

export function isReplicateImageModel(id: string): id is ReplicateImageModel {
  return id in IMAGE_MODEL_SLUGS;
}

async function fetchJSON(url: string, init: RequestInit): Promise<Response> {
  const r = await fetch(url, init);
  if (!r.ok) {
    let body = "";
    try {
      body = await r.text();
    } catch {
      body = r.statusText;
    }
    throw new Error(`Replicate ${r.status}: ${body.slice(0, 300)}`);
  }
  return r;
}

async function poll(
  id: string,
  apiToken: string,
  signal?: AbortSignal,
): Promise<Prediction> {
  let attempt = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const r = await fetchJSON(`${BASE}/predictions/${id}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal,
    });
    const p = (await r.json()) as Prediction;
    if (
      p.status === "succeeded" ||
      p.status === "failed" ||
      p.status === "canceled"
    ) {
      return p;
    }
    attempt += 1;
    const wait = Math.min(2500, 600 * Math.pow(1.2, attempt));
    await new Promise((res) => setTimeout(res, wait));
  }
}

function extractImageUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (typeof first === "string") return first;
  }
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.url === "string") return o.url;
    if (typeof o.image === "string") return o.image;
  }
  throw new Error("Replicate returned an unexpected output shape");
}

export type RunImageOpts = {
  model: ReplicateImageModel;
  prompt: string;
  aspect: Aspect;
  apiToken: string;
  signal?: AbortSignal;
};

function buildImageInput(opts: RunImageOpts): Record<string, unknown> {
  const aspect_ratio = opts.aspect;
  if (opts.model === "flux-1.1-pro") {
    return {
      prompt: opts.prompt,
      aspect_ratio,
      output_format: "webp",
      output_quality: 85,
      safety_tolerance: 2,
      prompt_upsampling: false,
    };
  }
  if (opts.model === "flux-schnell") {
    return {
      prompt: opts.prompt,
      aspect_ratio,
      output_format: "webp",
      output_quality: 85,
      num_outputs: 1,
      num_inference_steps: 4,
    };
  }
  if (opts.model === "sdxl") {
    const [w, h] = aspect_ratio === "9:16" ? [768, 1344] : aspect_ratio === "16:9" ? [1344, 768] : [1024, 1024];
    return {
      prompt: opts.prompt,
      width: w,
      height: h,
      num_outputs: 1,
      refine: "expert_ensemble_refiner",
    };
  }
  return {
    prompt: opts.prompt,
    aspect_ratio,
  };
}

export type ReplicateMotionModel =
  | "minimax-video-01"
  | "kling-2.0"
  | "luma-dream-machine"
  | "pika-2.0";

const MOTION_MODEL_SLUGS: Record<ReplicateMotionModel, string> = {
  "minimax-video-01": "minimax/video-01",
  "kling-2.0": "kwaivgi/kling-v1.6-standard",
  "luma-dream-machine": "luma/ray-flash-2-720p",
  "pika-2.0": "pika/pika-v2.2-720p",
};

export function isReplicateMotionModel(id: string): id is ReplicateMotionModel {
  return id in MOTION_MODEL_SLUGS;
}

export type RunMotionOpts = {
  model: ReplicateMotionModel;
  prompt: string;
  firstFrameUrl: string;
  durationSeconds: number;
  aspect: Aspect;
  apiToken: string;
  signal?: AbortSignal;
};

function buildMotionInput(opts: RunMotionOpts): Record<string, unknown> {
  const dur = Math.max(3, Math.min(10, Math.round(opts.durationSeconds)));
  if (opts.model === "minimax-video-01") {
    return {
      prompt: opts.prompt,
      first_frame_image: opts.firstFrameUrl,
      prompt_optimizer: false,
    };
  }
  if (opts.model === "kling-2.0") {
    return {
      prompt: opts.prompt,
      start_image: opts.firstFrameUrl,
      duration: dur >= 8 ? 10 : 5,
      aspect_ratio: opts.aspect,
      cfg_scale: 0.5,
    };
  }
  if (opts.model === "luma-dream-machine") {
    return {
      prompt: opts.prompt,
      start_image_url: opts.firstFrameUrl,
      aspect_ratio: opts.aspect,
      loop: false,
    };
  }
  if (opts.model === "pika-2.0") {
    return {
      prompt: opts.prompt,
      image: opts.firstFrameUrl,
      aspect_ratio: opts.aspect,
    };
  }
  return { prompt: opts.prompt, image: opts.firstFrameUrl };
}

function extractVideoUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (typeof first === "string") return first;
  }
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.url === "string") return o.url;
    if (typeof o.video === "string") return o.video;
  }
  throw new Error("Replicate returned an unexpected motion output shape");
}

export async function runReplicateMotion(opts: RunMotionOpts): Promise<string> {
  const slug = MOTION_MODEL_SLUGS[opts.model];
  const input = buildMotionInput(opts);
  const r = await fetchJSON(`${BASE}/models/${slug}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiToken}`,
      "Content-Type": "application/json",
      Prefer: "wait=30",
    },
    body: JSON.stringify({ input }),
    signal: opts.signal,
  });
  let pred = (await r.json()) as Prediction;
  if (pred.status === "starting" || pred.status === "processing") {
    pred = await poll(pred.id, opts.apiToken, opts.signal);
  }
  if (pred.status !== "succeeded") {
    throw new Error(pred.error || `Generation ${pred.status}`);
  }
  return extractVideoUrl(pred.output);
}

export type ReplicateMusicModel = "stable-audio";

const MUSIC_MODEL_SLUGS: Record<ReplicateMusicModel, string> = {
  "stable-audio": "stackadoc/stable-audio-open-1.0",
};

export function isReplicateMusicModel(id: string): id is ReplicateMusicModel {
  return id in MUSIC_MODEL_SLUGS;
}

export type RunMusicReplicateOpts = {
  model: ReplicateMusicModel;
  prompt: string;
  durationSeconds: number;
  apiToken: string;
  signal?: AbortSignal;
};

function extractAudioUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.length > 0 && typeof output[0] === "string") return output[0];
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.url === "string") return o.url;
    if (typeof o.audio === "string") return o.audio;
  }
  throw new Error("Replicate returned an unexpected audio output shape");
}

export async function runReplicateMusic(opts: RunMusicReplicateOpts): Promise<string> {
  const slug = MUSIC_MODEL_SLUGS[opts.model];
  const r = await fetchJSON(`${BASE}/models/${slug}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiToken}`,
      "Content-Type": "application/json",
      Prefer: "wait=30",
    },
    body: JSON.stringify({
      input: {
        prompt: opts.prompt,
        seconds_total: Math.min(60, Math.max(10, Math.round(opts.durationSeconds))),
      },
    }),
    signal: opts.signal,
  });
  let pred = (await r.json()) as Prediction;
  if (pred.status === "starting" || pred.status === "processing") {
    pred = await poll(pred.id, opts.apiToken, opts.signal);
  }
  if (pred.status !== "succeeded") {
    throw new Error(pred.error || `Generation ${pred.status}`);
  }
  return extractAudioUrl(pred.output);
}

export async function fetchAsDataUrl(url: string, signal?: AbortSignal): Promise<string> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Fetch ${r.status} for ${url}`);
  const blob = await r.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("FileReader returned non-string"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

export async function runReplicateImage(opts: RunImageOpts): Promise<string> {
  const slug = IMAGE_MODEL_SLUGS[opts.model];
  const input = buildImageInput(opts);
  const r = await fetchJSON(`${BASE}/models/${slug}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiToken}`,
      "Content-Type": "application/json",
      Prefer: "wait=30",
    },
    body: JSON.stringify({ input }),
    signal: opts.signal,
  });
  let pred = (await r.json()) as Prediction;
  if (pred.status === "starting" || pred.status === "processing") {
    pred = await poll(pred.id, opts.apiToken, opts.signal);
  }
  if (pred.status !== "succeeded") {
    throw new Error(pred.error || `Generation ${pred.status}`);
  }
  return extractImageUrl(pred.output);
}

export function composePromptWithBrief(
  prompt: string,
  briefVisual: string | undefined,
): string {
  const a = (briefVisual ?? "").trim();
  const b = (prompt ?? "").trim();
  if (!a) return b || "cinematic still";
  if (!b) return a;
  return `${a}, ${b}`;
}
