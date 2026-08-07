"use client";

// Shot detection ported from movie-digest (scripts/digest_movie.py) to run in
// the browser: ffmpeg.wasm replaces the ffmpeg subprocess, and canvas replaces
// Pillow + numpy. The algorithm is unchanged — sample densely, keep only the
// frames that changed from the last kept one, and record where the change was.

import type { Digest, DigestMode, Pointer, Shot } from "./types";
import { ensureFFmpeg } from "./render";

/**
 * Diff thresholds per mode, matching movie-digest's `--mode` presets. Lower
 * threshold means more frames survive the diff.
 */
export const MODE_THRESHOLDS: Record<DigestMode, number> = {
  insano: 0.6,
  strict: 1.0,
  standard: 1.5,
  lenient: 3.0,
};

export const MODE_LABELS: Record<DigestMode, string> = {
  insano: "Insano — every change",
  strict: "Strict — nothing missed",
  standard: "Standard — balanced",
  lenient: "Lenient — landmarks only",
};

/** Frames per second for the dense sampling pass. */
const SAMPLE_FPS = 2;
/** Width of the sampled JPEGs written by ffmpeg, in pixels. */
const SAMPLE_WIDTH = 480;
/** Width the grayscale comparison runs at — small is fine and much faster. */
const DIFF_WIDTH = 320;

export type DigestProgress = {
  phase: "loading-engine" | "sampling" | "scoring" | "done";
  pct: number;
  message: string;
};

export type DigestOptions = {
  file: File;
  mode?: DigestMode;
  maxFrames?: number;
  onProgress?: (p: DigestProgress) => void;
  signal?: AbortSignal;
};

function newId(prefix: string): string {
  const u =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${u.slice(0, 8)}`;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}

/** movie-digest's `region_label` — a 3x3 grid name for a normalized point. */
export function regionLabel(nx: number, ny: number): string {
  const col = nx < 1 / 3 ? "left" : nx > 2 / 3 ? "right" : "center";
  const row = ny < 1 / 3 ? "top" : ny > 2 / 3 ? "bottom" : "middle";
  return row === "middle" && col === "center" ? "center" : `${row}-${col}`;
}

/**
 * Decode a JPEG into a downscaled grayscale plane. The Python original used
 * `Image.convert("L")`; canvas gives us RGBA, so we apply the same luma
 * weights it uses internally.
 */
async function toGray(blob: Blob, downscaleTo = DIFF_WIDTH): Promise<{
  data: Int16Array;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(blob);
  try {
    const w = bitmap.width > downscaleTo ? downscaleTo : bitmap.width;
    const h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2d context not available");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const gray = new Int16Array(w * h);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      gray[p] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
    }
    return { data: gray, width: w, height: h };
  } finally {
    bitmap.close();
  }
}

type Gray = Awaited<ReturnType<typeof toGray>>;

/** Mean absolute difference between two grayscale planes. */
function meanAbsDiff(a: Gray, b: Gray): number {
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return n === 0 ? 0 : sum / n;
}

/**
 * movie-digest's `pointer_of` — centroid of the changed region between two
 * frames. Returns null when too little moved to localize anything.
 */
export function pointerOf(
  prev: Gray,
  cur: Gray,
  pixelThresh = 28,
  minPixels = 25,
): Pointer | null {
  const n = Math.min(prev.data.length, cur.data.length);
  if (n === 0) return null;
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  const w = cur.width;
  for (let i = 0; i < n; i++) {
    if (Math.abs(cur.data[i] - prev.data[i]) > pixelThresh) {
      count++;
      sumX += i % w;
      sumY += (i / w) | 0;
    }
  }
  if (count < minPixels) return null;
  const nx = sumX / count / w;
  const ny = sumY / count / cur.height;
  return {
    nx: Math.round(nx * 1000) / 1000,
    ny: Math.round(ny * 1000) / 1000,
    region: regionLabel(nx, ny),
    changed_fraction: Math.round((count / n) * 10000) / 10000,
  };
}

type SampledFrame = { index: number; blob: Blob };

type KeptFrame = {
  index: number;
  ts: number;
  score: number;
  pointer: Pointer | null;
  blob: Blob;
};

/**
 * movie-digest's `select_keyframes`. Keeps a frame when it differs from the
 * last *kept* frame (not the previous sampled one) by at least `threshold`,
 * always keeps the first and last, and when over `maxFrames` keeps the biggest
 * changes in between.
 */
export async function selectKeyframes(
  frames: SampledFrame[],
  fps: number,
  threshold: number,
  maxFrames: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<KeptFrame[]> {
  if (frames.length === 0) return [];

  const grays: (Gray | null)[] = new Array(frames.length).fill(null);
  const grayAt = async (i: number): Promise<Gray> => {
    const cached = grays[i];
    if (cached) return cached;
    const g = await toGray(frames[i].blob);
    grays[i] = g;
    return g;
  };

  const kept: KeptFrame[] = [
    { index: 0, ts: 0, score: 0, pointer: null, blob: frames[0].blob },
  ];
  let last = 0;

  for (let i = 1; i < frames.length; i++) {
    throwIfAborted(signal);
    const score = meanAbsDiff(await grayAt(i), await grayAt(last));
    if (score >= threshold) {
      kept.push({
        index: i,
        ts: i / fps,
        score: Math.round(score * 100) / 100,
        pointer: pointerOf(await grayAt(i - 1), await grayAt(i)),
        blob: frames[i].blob,
      });
      last = i;
    }
    // Grayscale planes are only ever compared against `last` or the immediate
    // predecessor, so anything older can go. Without this a long clip holds
    // every decoded plane at once.
    if (i - 2 > last) grays[i - 2] = null;
    onProgress?.(i + 1, frames.length);
  }

  const end = frames.length - 1;
  if (last !== end && end > 0) {
    kept.push({
      index: end,
      ts: end / fps,
      score: Math.round(meanAbsDiff(await grayAt(end), await grayAt(last)) * 100) / 100,
      pointer: pointerOf(await grayAt(end - 1), await grayAt(end)),
      blob: frames[end].blob,
    });
  }

  if (kept.length > maxFrames) {
    const middle = kept.slice(1, -1);
    middle.sort((a, b) => b.score - a.score);
    const top = middle.slice(0, Math.max(0, maxFrames - 2));
    top.sort((a, b) => a.ts - b.ts);
    return [kept[0], ...top, kept[kept.length - 1]];
  }
  return kept;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Unexpected FileReader result"));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

/** Read the source video's dimensions and duration without ffmpeg. */
async function probe(file: File): Promise<{ duration_s: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
      video.addEventListener(
        "error",
        () => reject(new Error(`Could not read video: ${video.error?.message ?? "unknown"}`)),
        { once: true },
      );
    });
    return {
      duration_s: Number.isFinite(video.duration) ? video.duration : 0,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Sample the video densely with one ffmpeg pass, then diff-select the shots.
 * Mirrors `dense_frames` + `select_keyframes` in the Python original.
 */
export async function digestVideo(opts: DigestOptions): Promise<Digest> {
  const { file, mode = "standard", maxFrames = 40, onProgress, signal } = opts;
  throwIfAborted(signal);

  const meta = await probe(file);
  onProgress?.({ phase: "loading-engine", pct: 5, message: "Loading ffmpeg.wasm engine…" });
  const { ffmpeg, fetchFile } = await ensureFFmpeg();
  throwIfAborted(signal);

  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "mp4";
  const inName = `digest_in.${ext}`;
  const written: string[] = [inName];

  try {
    onProgress?.({ phase: "sampling", pct: 15, message: "Sampling frames…" });
    await ffmpeg.writeFile(inName, await fetchFile(file));
    throwIfAborted(signal);

    await ffmpeg.exec([
      "-i",
      inName,
      "-vf",
      `fps=${SAMPLE_FPS},scale=${SAMPLE_WIDTH}:-2`,
      "-q:v",
      "4",
      "d%05d.jpg",
    ]);
    throwIfAborted(signal);

    const dir = await ffmpeg.listDir("/");
    const names = dir
      .map((n: { name: string }) => n.name)
      .filter((n: string) => /^d\d{5}\.jpg$/.test(n))
      .sort();
    if (names.length === 0) {
      throw new Error("ffmpeg produced no frames — the file may not be a video this browser can decode.");
    }
    written.push(...names);

    const frames: SampledFrame[] = [];
    for (let i = 0; i < names.length; i++) {
      const data = (await ffmpeg.readFile(names[i])) as Uint8Array;
      // Copy out of the wasm heap — the underlying buffer gets reused.
      frames.push({ index: i, blob: new Blob([new Uint8Array(data)], { type: "image/jpeg" }) });
    }

    onProgress?.({ phase: "scoring", pct: 45, message: `Scoring ${frames.length} frames…` });
    const kept = await selectKeyframes(
      frames,
      SAMPLE_FPS,
      MODE_THRESHOLDS[mode],
      maxFrames,
      (done, total) => {
        onProgress?.({
          phase: "scoring",
          pct: 45 + Math.round((done / total) * 45),
          message: `Scoring frame ${done} of ${total}…`,
        });
      },
      signal,
    );

    const shots: Shot[] = [];
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i];
      const next = kept[i + 1];
      const end = next ? next.ts : meta.duration_s || k.ts + 3;
      shots.push({
        id: newId("shot"),
        start_s: Math.round(k.ts * 100) / 100,
        duration_s: Math.max(0.5, Math.round((end - k.ts) * 100) / 100),
        thumbnail: await blobToDataUrl(k.blob),
        change_score: k.score,
        pointer: k.pointer,
      });
    }

    onProgress?.({ phase: "done", pct: 100, message: `${shots.length} shots detected.` });
    return {
      source_name: file.name,
      duration_s: meta.duration_s,
      width: meta.width,
      height: meta.height,
      mode,
      sampled_frames: frames.length,
      shots,
    };
  } finally {
    for (const n of written) {
      try {
        await ffmpeg.deleteFile(n);
      } catch {
        // best effort — a leftover file only costs wasm heap until reload
      }
    }
  }
}
