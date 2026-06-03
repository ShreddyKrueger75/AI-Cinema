"use client";

import type { Project } from "./types";

export function exportProjectJSON(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export type ImportResult = { ok: true; project: Project } | { ok: false; error: string };

export function importProjectJSON(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Project JSON must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schema_version !== 1) {
    return { ok: false, error: `Unsupported schema_version: ${String(obj.schema_version)}` };
  }
  for (const key of ["id", "name", "aspect", "sections", "transitions"]) {
    if (!(key in obj)) return { ok: false, error: `Missing required field: ${key}` };
  }
  if (!Array.isArray(obj.sections)) return { ok: false, error: "sections must be an array" };
  return { ok: true, project: raw as Project };
}

export function downloadProjectJSON(project: Project): void {
  const json = exportProjectJSON(project);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  a.href = url;
  a.download = `${safeName}.ai-cinema.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function pickProjectJSONFile(): Promise<ImportResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ ok: false, error: "No file selected" });
        return;
      }
      const text = await file.text();
      resolve(importProjectJSON(text));
    };
    input.click();
  });
}
