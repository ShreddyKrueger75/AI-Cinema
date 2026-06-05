import type { Aspect } from "./types";

export function aspectDims(aspect: Aspect): { w: number; h: number } {
  if (aspect === "16:9") return { w: 1024, h: 576 };
  if (aspect === "1:1") return { w: 1024, h: 1024 };
  return { w: 576, h: 1024 };
}

// When a token is provided, return a same-origin proxy URL — the token
// is sent in an x-provider-key header by the caller, never in the URL
// (URLs leak via access logs, browser history, and Referer headers).
// Without a token, hit pollinations.ai direct (it ships CORS headers).
export function pollinationsUrl(
  prompt: string,
  aspect: Aspect,
  seed: number,
  brief?: string,
  token?: string,
): string {
  const dims = aspectDims(aspect);
  const composed = [brief?.trim(), prompt.trim()].filter(Boolean).join(", ") || "cinematic still";
  const safe = encodeURIComponent(composed);
  const params = new URLSearchParams({
    width: String(dims.w),
    height: String(dims.h),
    seed: String(seed),
    nologo: "true",
    model: "flux",
  });
  const base = token?.trim()
    ? "/api/proxy/pollinations"
    : "https://image.pollinations.ai";
  return `${base}/prompt/${safe}?${params.toString()}`;
}

export type KenBurnsDirection = "in" | "out" | "left" | "right";

export function kenBurnsFromPrompt(prompt: string): KenBurnsDirection {
  const p = prompt.toLowerCase();
  if (/\b(pull back|zoom out|dolly out|pulling away|wide reveal|reveal wide)\b/.test(p)) return "out";
  if (/\b(pan left|moves left|drift left|slide left|left to right)\b/.test(p)) return "right";
  if (/\b(pan right|moves right|drift right|slide right|right to left)\b/.test(p)) return "left";
  return "in";
}

export function newSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}
