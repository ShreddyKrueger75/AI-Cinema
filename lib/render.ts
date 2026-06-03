"use client";

import type { Aspect, Project, Section } from "./types";

export type RenderProgress = {
  phase: "loading-engine" | "fetching-assets" | "encoding" | "writing" | "done" | "error";
  pct: number;
  message: string;
};

export type RenderOptions = {
  project: Project;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
};

type Asset = {
  sectionId: string;
  kind: "video" | "still" | "title" | "missing";
  url?: string;
  duration_s: number;
};

function aspectToWH(aspect: Aspect): { w: number; h: number } {
  if (aspect === "16:9") return { w: 1280, h: 720 };
  if (aspect === "1:1") return { w: 720, h: 720 };
  return { w: 720, h: 1280 };
}

function planAssets(project: Project): Asset[] {
  const out: Asset[] = [];
  for (const s of project.sections) {
    if (s.type === "title") {
      const v = s.versions.find((x) => x.id === s.active_version_id);
      if (v && v.kind === "title" && v.text.trim().length > 0) {
        out.push({ sectionId: s.id, kind: "title", duration_s: s.duration_s });
      } else {
        out.push({ sectionId: s.id, kind: "missing", duration_s: s.duration_s });
      }
      continue;
    }
    const active = s.versions.find((v) => v.id === s.active_version_id);
    if (!active || active.kind !== "clip") {
      out.push({ sectionId: s.id, kind: "missing", duration_s: s.duration_s });
      continue;
    }
    const u = active.output_url;
    if (u && /^https?:\/\//.test(u)) {
      out.push({ sectionId: s.id, kind: "video", url: u, duration_s: s.duration_s });
      continue;
    }
    const stillId = active.still_ref ?? s.active_still_id;
    const still = stillId ? s.stills.find((st) => st.id === stillId) : undefined;
    if (still?.output_url) {
      out.push({
        sectionId: s.id,
        kind: "still",
        url: still.output_url,
        duration_s: active.motion.duration_s || s.duration_s,
      });
      continue;
    }
    out.push({ sectionId: s.id, kind: "missing", duration_s: s.duration_s });
  }
  return out;
}

function renderTitleCardPng(opts: {
  text: string;
  w: number;
  h: number;
  font: string;
  color: string;
  bg: string;
}): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = opts.w;
  canvas.height = opts.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context not available");
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, opts.w, opts.h);
  const fontSize = Math.round(Math.min(opts.w, opts.h) * 0.085);
  ctx.fillStyle = opts.color;
  ctx.font = `bold ${fontSize}px ${opts.font.split(" ")[0] || "sans-serif"}, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, opts.text.toUpperCase(), opts.w * 0.85);
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;
  const startY = opts.h / 2 - totalHeight / 2 + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], opts.w / 2, startY + i * lineHeight);
  }
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export type RenderPlanIssue = {
  sectionId: string;
  index: number;
  title: string;
  reason: string;
};

export function describeRenderPlan(project: Project): {
  ready: boolean;
  assets: Asset[];
  issues: RenderPlanIssue[];
  totalDuration: number;
} {
  const assets = planAssets(project);
  const issues: RenderPlanIssue[] = [];
  for (const a of assets) {
    if (a.kind === "missing") {
      const sec = project.sections.find((s) => s.id === a.sectionId);
      if (!sec) continue;
      issues.push({
        sectionId: sec.id,
        index: sec.index,
        title: sec.title,
        reason:
          sec.type === "clip"
            ? "no rendered video and no still"
            : "title text is empty",
      });
    }
  }
  const totalDuration = assets.reduce((acc, a) => acc + a.duration_s, 0);
  return { ready: issues.length === 0, assets, issues, totalDuration };
}

let ffmpegSingleton: unknown | null = null;
let ffmpegLoadPromise: Promise<unknown> | null = null;

async function ensureFFmpeg(onProgress?: (p: RenderProgress) => void): Promise<{
  ffmpeg: any;
  fetchFile: (file: string | Blob) => Promise<Uint8Array>;
}> {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");

  if (ffmpegSingleton) {
    return { ffmpeg: ffmpegSingleton, fetchFile };
  }
  if (ffmpegLoadPromise) {
    const ff = await ffmpegLoadPromise;
    return { ffmpeg: ff, fetchFile };
  }

  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", () => {});
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
    onProgress?.({
      phase: "loading-engine",
      pct: 5,
      message: "Loading ffmpeg.wasm engine (~30MB)…",
    });
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegSingleton = ffmpeg;
    return ffmpeg;
  })();

  const ffmpeg = await ffmpegLoadPromise;
  return { ffmpeg, fetchFile };
}

function nameFor(section: Section, ext: string): string {
  return `seg_${section.index.toString().padStart(2, "0")}.${ext}`;
}

export async function renderProject(opts: RenderOptions): Promise<{ url: string; sizeBytes: number }> {
  const { project, onProgress, signal } = opts;
  const plan = describeRenderPlan(project);
  if (plan.issues.length > 0) {
    throw new Error(
      `Cannot render: ${plan.issues.length} section${plan.issues.length === 1 ? "" : "s"} not ready (${plan.issues.map((i) => `${i.index.toString().padStart(2, "0")} ${i.reason}`).join("; ")})`,
    );
  }

  const { w, h } = aspectToWH(project.aspect);
  const { ffmpeg, fetchFile } = await ensureFFmpeg(onProgress);

  if (signal?.aborted) throw new DOMException("aborted", "AbortError");

  const segNames: string[] = [];

  for (let i = 0; i < plan.assets.length; i++) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const a = plan.assets[i];
    const section = project.sections.find((s) => s.id === a.sectionId);
    if (!section) continue;

    onProgress?.({
      phase: "fetching-assets",
      pct: 10 + Math.round(((i + 1) / plan.assets.length) * 30),
      message: `Fetching section ${section.index.toString().padStart(2, "0")} — ${section.title}`,
    });

    if (a.kind === "video" && a.url) {
      const data = await fetchFile(a.url);
      const inName = `in_${i}.mp4`;
      await ffmpeg.writeFile(inName, data);
      const outName = nameFor(section, "ts");
      await ffmpeg.exec([
        "-i", inName,
        "-t", a.duration_s.toFixed(2),
        "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-an",
        "-bsf:v", "h264_mp4toannexb",
        "-f", "mpegts",
        outName,
      ]);
      segNames.push(outName);
      continue;
    }

    if (a.kind === "still" && a.url) {
      const data = await fetchFile(a.url);
      const inName = `still_${i}.jpg`;
      await ffmpeg.writeFile(inName, data);
      const outName = nameFor(section, "ts");
      const dur = a.duration_s.toFixed(2);
      const totalFrames = Math.round(a.duration_s * 30);
      await ffmpeg.exec([
        "-loop", "1",
        "-t", dur,
        "-i", inName,
        "-vf",
        `scale=${Math.round(w * 1.2)}:${Math.round(h * 1.2)}:force_original_aspect_ratio=increase,crop=${Math.round(w * 1.2)}:${Math.round(h * 1.2)},zoompan=z='min(zoom+0.0008,1.18)':d=${totalFrames}:s=${w}x${h}:fps=30,setsar=1`,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-an",
        "-bsf:v", "h264_mp4toannexb",
        "-f", "mpegts",
        outName,
      ]);
      segNames.push(outName);
      continue;
    }

    if (a.kind === "title") {
      const activeVersion = section.versions.find((v) => v.id === section.active_version_id);
      const text = activeVersion && activeVersion.kind === "title" ? activeVersion.text : "";
      const ts = project.title_settings;
      const png = renderTitleCardPng({
        text,
        w,
        h,
        font: ts?.font ?? "JetBrains Mono",
        color: ts?.color ?? "#f4f1ea",
        bg: ts?.background_color ?? "#0a0908",
      });
      const inName = `title_${i}.png`;
      await ffmpeg.writeFile(inName, png);
      const outName = nameFor(section, "ts");
      await ffmpeg.exec([
        "-loop", "1",
        "-t", a.duration_s.toFixed(2),
        "-i", inName,
        "-vf",
        `scale=${w}:${h}:flags=lanczos,fade=t=in:st=0:d=0.3,fade=t=out:st=${Math.max(0, a.duration_s - 0.3).toFixed(2)}:d=0.3,setsar=1`,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-an",
        "-bsf:v", "h264_mp4toannexb",
        "-f", "mpegts",
        outName,
      ]);
      segNames.push(outName);
      continue;
    }
  }

  if (segNames.length === 0) {
    throw new Error("Nothing to render — no video or still assets available.");
  }

  onProgress?.({ phase: "encoding", pct: 70, message: "Concatenating segments…" });

  const concatList = segNames.map((n) => `file '${n}'`).join("\n");
  await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(concatList));

  await ffmpeg.exec([
    "-f", "concat",
    "-safe", "0",
    "-i", "concat.txt",
    "-c", "copy",
    "out_mux.ts",
  ]);

  onProgress?.({ phase: "writing", pct: 90, message: "Muxing to MP4…" });

  await ffmpeg.exec([
    "-i", "out_mux.ts",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "out.mp4",
  ]);

  const data = (await ffmpeg.readFile("out.mp4")) as Uint8Array;
  const blob = new Blob([data], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);

  for (const n of [...segNames, "out_mux.ts", "out.mp4", "concat.txt"]) {
    try {
      await ffmpeg.deleteFile(n);
    } catch {
      // best effort
    }
  }

  onProgress?.({ phase: "done", pct: 100, message: "Done." });
  return { url, sizeBytes: blob.size };
}
