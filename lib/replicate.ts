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
