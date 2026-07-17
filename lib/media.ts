"use client";

import { putAsset, getAsset, isAssetUri } from "./asset-store";
import { toast } from "./toast";

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// Every media import routes through pickFile, so one cap here covers all
// of them. 2 GB is far above any sane clip and below what wedges the tab.
const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      if (file && file.size > MAX_IMPORT_BYTES) {
        toast.error(
          "File too large",
          `${file.name} is ${(file.size / 1024 ** 3).toFixed(1)} GB — the import cap is 2 GB.`,
        );
        resolve(null);
        return;
      }
      resolve(file);
    };
    input.click();
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
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

export async function dataUrlToAsset(dataUrl: string): Promise<string> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    return await putAsset(blob);
  } catch {
    return dataUrl;
  }
}

export async function resolveToApiDataUrl(url: string): Promise<string> {
  if (isAssetUri(url)) {
    const blob = await getAsset(url);
    if (!blob) throw new Error("Still is missing from local storage — re-generate it.");
    return blobToDataUrl(blob);
  }
  if (url.startsWith("blob:")) {
    return blobToDataUrl(await (await fetch(url)).blob());
  }
  return url;
}

export function canBrowserPlayVideo(file: File): { ok: boolean; reason?: string } {
  const v = document.createElement("video");
  const mime = file.type || "";
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (mime && v.canPlayType(mime) !== "") return { ok: true };
  const fallback: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogv: "video/ogg",
    ogg: "video/ogg",
    "3gp": "video/3gpp",
    "3g2": "video/3gpp2",
  };
  const guess = fallback[ext];
  if (guess && v.canPlayType(guess) !== "") return { ok: true };
  return {
    ok: false,
    reason: `Your browser can't play .${ext || mime || "this format"}. Try .mp4, .webm, .mov (H.264), or .ogv.`,
  };
}

export function canBrowserPlayAudio(file: File): { ok: boolean; reason?: string } {
  const a = document.createElement("audio");
  const mime = file.type || "";
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (mime && a.canPlayType(mime) !== "") return { ok: true };
  const fallback: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg; codecs=opus",
    flac: "audio/flac",
    webm: "audio/webm",
  };
  const guess = fallback[ext];
  if (guess && a.canPlayType(guess) !== "") return { ok: true };
  return {
    ok: false,
    reason: `Your browser can't play .${ext || mime || "this format"}. Try .mp3, .wav, .m4a, or .ogg.`,
  };
}

export function extractVideoPosterDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("error", onError);
      URL.revokeObjectURL(url);
    };
    const onLoaded = () => {
      try {
        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 720;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { cleanup(); resolve(null); return; }
        ctx.drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        cleanup();
        resolve(dataUrl);
      } catch {
        cleanup();
        resolve(null);
      }
    };
    const onError = () => { cleanup(); resolve(null); };
    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("error", onError);
    video.src = url;
    // Some browsers won't fire loadeddata until we seek
    video.currentTime = 0.1;
  });
}

export function measureAudioDuration(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = "metadata";
    const cleanup = () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve(a.duration);
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not read audio metadata"));
    };
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("error", onError);
    a.src = src;
  });
}
