"use client";

import type { Aspect, GraphicOverlay, Project, Section, Transition } from "./types";
import { buildCubeLUT, buildFFmpegGradeFilter } from "./grade";

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

// Render a graphic overlay (text) as a transparent PNG sized to the frame.
// Layout matches the CSS preview: bold, centered, positioned top/center/bottom
// at 4% margin, font size scales with the smaller dimension, drop shadow.
function renderGraphicOverlayPng(opts: {
  text: string;
  w: number;
  h: number;
  font: string;
  color: string;
  position: "top" | "center" | "bottom";
}): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = opts.w;
  canvas.height = opts.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context not available");
  ctx.clearRect(0, 0, opts.w, opts.h);
  const fontSize = Math.round(Math.min(opts.w, opts.h) * 0.06);
  ctx.fillStyle = opts.color;
  ctx.font = `bold ${fontSize}px ${opts.font.split(" ")[0] || "sans-serif"}, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  const lines = wrapLines(ctx, opts.text, opts.w * 0.85);
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;
  const margin = opts.h * 0.04;
  let centerY: number;
  if (opts.position === "top") centerY = margin + totalHeight / 2;
  else if (opts.position === "bottom") centerY = opts.h - margin - totalHeight / 2;
  else centerY = opts.h / 2;
  const startY = centerY - totalHeight / 2 + lineHeight / 2;
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
      let reason: string;
      if (sec.type === "title") {
        reason = "empty title text";
      } else {
        const active = sec.versions.find((v) => v.id === sec.active_version_id);
        if (!active || active.kind !== "clip") {
          reason = "no active version";
        } else if (sec.stills.length === 0 || !sec.active_still_id) {
          reason = "no still added";
        } else {
          reason = "motion not generated";
        }
      }
      issues.push({
        sectionId: sec.id,
        index: sec.index,
        title: sec.title,
        reason,
      });
    }
  }
  const totalDuration = assets.reduce((acc, a) => acc + a.duration_s, 0);
  return { ready: issues.length === 0, assets, issues, totalDuration };
}

let ffmpegSingleton: any | null = null;
let ffmpegLoadPromise: Promise<unknown> | null = null;

export async function terminateFFmpeg(): Promise<void> {
  if (ffmpegSingleton) {
    try {
      ffmpegSingleton.terminate();
    } catch {
      // best effort
    }
    ffmpegSingleton = null;
    ffmpegLoadPromise = null;
  }
}

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
        `scale=${w}:${h}:flags=lanczos,setsar=1`,
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

  onProgress?.({ phase: "encoding", pct: 70, message: "Applying transitions…" });

  const trByTo = new Map<string, Transition>();
  for (const t of project.transitions) trByTo.set(t.to_section_id, t);

  const inputArgs: string[] = [];
  for (const n of segNames) {
    inputArgs.push("-i", n);
  }

  const parts: string[] = [];
  for (let i = 0; i < segNames.length; i++) {
    parts.push(`[${i}:v]format=yuv420p,fps=30,setpts=PTS-STARTPTS[s${i}]`);
  }

  let outLabel = "[s0]";
  if (segNames.length > 1) {
    let cumDur = plan.assets[0].duration_s;
    for (let i = 1; i < segNames.length; i++) {
      const tr = trByTo.get(plan.assets[i].sectionId);
      const xfTransition =
        tr?.type === "fade_black" ? "fadeblack" : tr?.type === "cut" ? "fade" : "fade";
      const rawDur = tr?.type === "cut" ? 0.04 : tr?.duration_s ?? 0.4;
      const xfDur = Math.max(0.04, Math.min(rawDur, plan.assets[i].duration_s - 0.04));
      const offset = Math.max(0, cumDur - xfDur);
      const label = i === segNames.length - 1 ? "vchain" : `vx${i}`;
      parts.push(
        `${outLabel}[s${i}]xfade=transition=${xfTransition}:duration=${xfDur.toFixed(3)}:offset=${offset.toFixed(3)}[${label}]`,
      );
      outLabel = `[${label}]`;
      cumDur += plan.assets[i].duration_s - xfDur;
    }
  }
  const totalVideoSeconds =
    segNames.length > 1
      ? plan.assets.reduce((acc, a, i) => {
          if (i === 0) return a.duration_s;
          const tr = trByTo.get(a.sectionId);
          const rawDur = tr?.type === "cut" ? 0.04 : tr?.duration_s ?? 0.4;
          const xfDur = Math.max(0.04, Math.min(rawDur, a.duration_s - 0.04));
          return acc + a.duration_s - xfDur;
        }, 0)
      : plan.assets[0]?.duration_s ?? 0;
  parts.push(`${outLabel}null[vout]`);

  const filterComplex = parts.join(";");

  await ffmpeg.exec([
    ...inputArgs,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-an",
    "-t", totalVideoSeconds.toFixed(3),
    "out_mux.mp4",
  ]);

  const audioFiles: string[] = [];
  let audioMixName: string | null = null;

  const voWithAudio = project.vo_segments.filter((v) => v.output_url && v.duration_s > 0);
  const musicSegsWithAudio = (project.music_segments ?? []).filter(
    (m) => m.output_url && m.duration_s > 0,
  );
  const hasMusic = !!project.music_track?.output_url;
  if (voWithAudio.length > 0 || hasMusic || musicSegsWithAudio.length > 0) {
    onProgress?.({ phase: "encoding", pct: 80, message: "Mixing audio (VO + music)…" });
    const inputs: string[] = [];
    const filterParts: string[] = [];
    const mixLabels: string[] = [];
    let inputIndex = 0;

    const audioTotalSeconds = totalVideoSeconds;
    // Duck music whenever any VO exists at all (static ducking — dynamic
    // sidechain would be cleaner but isn't available in the minimal wasm
    // build).
    const musicVolume = voWithAudio.length > 0 ? "0.35" : "0.7";

    if (hasMusic) {
      const musicData = await fetchFile(project.music_track!.output_url!);
      const musicName = "music.mp3";
      await ffmpeg.writeFile(musicName, musicData);
      audioFiles.push(musicName);
      inputs.push("-i", musicName);
      filterParts.push(
        `[${inputIndex}:a]aresample=44100,atrim=0:${audioTotalSeconds.toFixed(2)},apad=whole_dur=${audioTotalSeconds.toFixed(2)},volume=${musicVolume}[mus]`,
      );
      mixLabels.push("[mus]");
      inputIndex += 1;
    }

    // Music segments — positioned by start_s like VO but at music-level
    // volume. Each segment's audio is trimmed to its duration_s window then
    // delayed onto the timeline.
    for (let i = 0; i < musicSegsWithAudio.length; i++) {
      const seg = musicSegsWithAudio[i];
      const name = `mseg_${i}.mp3`;
      const data = await fetchFile(seg.output_url!);
      await ffmpeg.writeFile(name, data);
      audioFiles.push(name);
      inputs.push("-i", name);
      const delayMs = Math.max(0, Math.round(seg.start_s * 1000));
      const segDur = Math.max(0.1, seg.duration_s);
      filterParts.push(
        `[${inputIndex}:a]aresample=44100,atrim=0:${segDur.toFixed(2)},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs},volume=${musicVolume}[mseg${i}]`,
      );
      mixLabels.push(`[mseg${i}]`);
      inputIndex += 1;
    }

    voWithAudio.forEach((seg, i) => {
      const name = `vo_${i}.mp3`;
      audioFiles.push(name);
      inputs.push("-i", name);
      const delayMs = Math.max(0, Math.round(seg.start_s * 1000));
      const segDur = Math.max(0.1, seg.duration_s);
      filterParts.push(
        `[${inputIndex}:a]aresample=44100,atrim=0:${segDur.toFixed(2)},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs},volume=1.0[vo${i}]`,
      );
      mixLabels.push(`[vo${i}]`);
      inputIndex += 1;
    });

    for (let i = 0; i < voWithAudio.length; i++) {
      const seg = voWithAudio[i];
      const data = await fetchFile(seg.output_url!);
      await ffmpeg.writeFile(`vo_${i}.mp3`, data);
    }

    const mixDuration = audioTotalSeconds.toFixed(2);
    const amix =
      mixLabels.length > 1
        ? `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:normalize=0[a]`
        : `${mixLabels[0]}anull[a]`;
    const filterGraph = `${filterParts.join(";")};${amix}`;

    audioMixName = "mix.m4a";
    await ffmpeg.exec([
      ...inputs,
      "-filter_complex", filterGraph,
      "-map", "[a]",
      "-c:a", "aac",
      "-b:a", "192k",
      "-t", mixDuration,
      audioMixName,
    ]);
  }

  onProgress?.({ phase: "writing", pct: 92, message: "Muxing to MP4…" });

  // The minimal `@ffmpeg/core` wasm build doesn't include `lut3d`, so the
  // previous LUT-file-on-disk approach was silently a no-op. Apply the grade
  // via the built-in `eq` + `colorbalance` (+ optional `curves`) filters
  // instead. `buildCubeLUT` is still kept around for the Export LUT button.
  void buildCubeLUT;
  const gradeFilter = project.grade ? buildFFmpegGradeFilter(project.grade) : null;

  // Prepare graphic overlays — one PNG per graphic (transparent background
  // for text, or the imported image file). Filter graph chains them with
  // time-gated `enable` so each shows only in its window.
  const graphics: GraphicOverlay[] = (project.graphics ?? []).filter(
    (g) => g.duration_s > 0 && g.start_s < totalVideoSeconds && (g.text || g.image_url),
  );
  const graphicFiles: string[] = [];
  const graphicInputs: string[] = [];
  for (let i = 0; i < graphics.length; i++) {
    const g = graphics[i];
    const name = `graphic_${i}.png`;
    if (g.image_url) {
      try {
        const data = await fetchFile(g.image_url);
        await ffmpeg.writeFile(name, data);
      } catch {
        continue;
      }
    } else {
      const png = renderGraphicOverlayPng({
        text: g.text,
        w,
        h,
        font: g.font ?? project.title_settings?.font ?? "JetBrains Mono",
        color: g.color ?? project.title_settings?.color ?? "#f4f1ea",
        position: g.position ?? "center",
      });
      await ffmpeg.writeFile(name, png);
    }
    graphicFiles.push(name);
    graphicInputs.push("-i", name);
  }

  // Build the video filter graph: grade → overlay graphic_0 → overlay
  // graphic_1 → ... → [vout]
  const baseLabel = "[0:v]";
  const filterChain: string[] = [];
  const gradedLabel = gradeFilter ? "[vg]" : baseLabel;
  if (gradeFilter) {
    filterChain.push(`${baseLabel}${gradeFilter}[vg]`);
  }
  let currentLabel = gradedLabel;
  // Inputs in the final ffmpeg.exec: index 0 = out_mux.mp4, index 1 =
  // audioMixName (if present), then graphics. Compute the offset.
  const graphicsInputOffset = audioMixName ? 2 : 1;
  for (let i = 0; i < graphicFiles.length; i++) {
    const g = graphics[i];
    const startS = Math.max(0, g.start_s);
    const endS = Math.min(totalVideoSeconds, g.start_s + g.duration_s);
    // For image graphics, scale to fit max 60% of frame; for text PNGs we
    // rendered at full WxH already so just position at origin.
    const isImage = !!g.image_url;
    const enable = `enable='between(t,${startS.toFixed(2)},${endS.toFixed(2)})'`;
    const inputIdx = graphicsInputOffset + i;
    const nextLabel = `[vov${i}]`;
    if (isImage) {
      const scale = `scale=w='if(gt(iw,ih),min(${w}*0.6,iw),-1)':h='if(gt(iw,ih),-1,min(${h}*0.6,ih))'`;
      const yExpr =
        g.position === "top"
          ? `${Math.round(h * 0.04)}`
          : g.position === "bottom"
          ? `H-h-${Math.round(h * 0.04)}`
          : "(H-h)/2";
      filterChain.push(
        `[${inputIdx}:v]${scale}[gimg${i}];${currentLabel}[gimg${i}]overlay=x=(W-w)/2:y=${yExpr}:${enable}${nextLabel}`,
      );
    } else {
      // Text PNG already sized WxH with position baked in.
      filterChain.push(`${currentLabel}[${inputIdx}:v]overlay=0:0:${enable}${nextLabel}`);
    }
    currentLabel = nextLabel;
  }
  filterChain.push(`${currentLabel}null[vout]`);
  const usingFilterGraph = filterChain.length > 1 || !!gradeFilter;
  const filterArgs = usingFilterGraph
    ? ["-filter_complex", filterChain.join(";"), "-map", "[vout]"]
    : ["-map", "0:v"];

  if (audioMixName) {
    await ffmpeg.exec([
      "-i", "out_mux.mp4",
      "-i", audioMixName,
      ...graphicInputs,
      ...filterArgs,
      "-map", "1:a",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-shortest",
      "-movflags", "+faststart",
      "out.mp4",
    ]);
  } else {
    await ffmpeg.exec([
      "-i", "out_mux.mp4",
      ...graphicInputs,
      ...filterArgs,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "out.mp4",
    ]);
  }

  const data = (await ffmpeg.readFile("out.mp4")) as Uint8Array;
  const blob = new Blob([data], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);

  const cleanup = [
    ...segNames,
    "out_mux.mp4",
    "out.mp4",
    ...audioFiles,
    ...graphicFiles,
    ...(audioMixName ? [audioMixName] : []),
  ];
  for (const n of cleanup) {
    try {
      await ffmpeg.deleteFile(n);
    } catch {
      // best effort
    }
  }

  onProgress?.({ phase: "done", pct: 100, message: "Done." });
  return { url, sizeBytes: blob.size };
}
