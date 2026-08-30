import type { Aspect, Grade, Project } from "@/lib/types";
import { buildCubeLUT } from "@/lib/grade";

export const ASPECT_OPTIONS: Aspect[] = ["9:16", "16:9", "1:1"];

export const SECTION_DURATION_OPTIONS_S = [1, 2, 3, 4, 5, 6, 8, 10];

export function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatTransition(type: string, duration: number): string {
  if (type === "cut") return "Cut";
  if (type === "fade_black") return "Fade to black";
  return `Crossfade ${duration.toFixed(1)}s`;
}

export function formatCost(c: number): string {
  return c >= 1 ? `~ $${c.toFixed(2)}` : `~ $${c.toFixed(3)}`;
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
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

export function projectHasGeneratedContent(project: Project): boolean {
  return project.sections.some(
    (s) =>
      s.stills.some((st) => !!st.output_url) ||
      s.versions.some((v) => v.kind === "clip" && !!v.output_url),
  );
}

export function templateIcon(id: string): string {
  switch (id) {
    case "tpl_blank": return "◯";
    case "tpl_product_reveal": return "◉";
    case "tpl_title_card": return "T";
    case "tpl_tutorial_3shot": return "⌗";
    case "tpl_dark_drop": return "◖";
    default: return "▪";
  }
}

/* ───────────── LUT EXPORT ───────────── */

export function downloadCubeLUT(grade: Grade): void {
  const content = buildCubeLUT(grade);
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = grade.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "grade";
  a.href = url;
  a.download = `${safe}.cube`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
