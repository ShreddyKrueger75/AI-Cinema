"use client";

export async function extractLastFrameDataUrl(videoUrl: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");

  let blobUrl: string | null = null;
  try {
    const r = await fetch(videoUrl, { signal, credentials: "omit" });
    if (!r.ok) throw new Error(`Fetch ${r.status} ${r.statusText}`);
    const blob = await r.blob();
    blobUrl = URL.createObjectURL(blob);

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = blobUrl;

    await new Promise<void>((resolve, reject) => {
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error(`Video load failed: ${video.error?.message ?? "unknown"}`));
      };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onLoad);
        video.removeEventListener("error", onErr);
      };
      video.addEventListener("loadedmetadata", onLoad, { once: true });
      video.addEventListener("error", onErr, { once: true });
      if (signal) {
        const onAbort = () => {
          cleanup();
          reject(new DOMException("aborted", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });

    const target = Math.max(0, video.duration - 0.08);
    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error("Seek failed"));
      };
      const cleanup = () => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onErr);
      };
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onErr, { once: true });
      video.currentTime = target;
    });

    const canvas = document.createElement("canvas");
    const w = video.videoWidth || 720;
    const h = video.videoHeight || 1280;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2d context not available");
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

export function parseLastFrameRef(input_ref: string | null | undefined): string | null {
  if (!input_ref) return null;
  const m = input_ref.match(/^section:(.+):last_frame$/);
  return m ? m[1] : null;
}
