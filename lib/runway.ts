import type { Aspect } from "./types";
import { recordModelSpend } from "./costs";

export type RunwayMotionModel = "runway-gen4" | "runway-gen3";

export function isRunwayMotionModel(id: string): id is RunwayMotionModel {
  return id === "runway-gen4" || id === "runway-gen3";
}

const RUNWAY_MODEL_NAMES: Record<RunwayMotionModel, string> = {
  "runway-gen4": "gen4_turbo",
  "runway-gen3": "gen3a_turbo",
};

function aspectToRatio(model: RunwayMotionModel, aspect: Aspect): string {
  // gen4_turbo accepts 1280:720, 720:1280, 960:960, 1104:832, 832:1104
  // gen3a_turbo accepts 1280:768, 768:1280, 960:960
  if (model === "runway-gen4") {
    if (aspect === "16:9") return "1280:720";
    if (aspect === "9:16") return "720:1280";
    return "960:960";
  }
  if (aspect === "16:9") return "1280:768";
  if (aspect === "9:16") return "768:1280";
  return "960:960";
}

type Task = {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "THROTTLED";
  output?: string[];
  failure?: string;
  failureCode?: string;
};

export type RunRunwayMotionOpts = {
  model: RunwayMotionModel;
  prompt: string;
  firstFrameUrl: string;
  durationSeconds: number;
  aspect: Aspect;
  apiToken: string;
  signal?: AbortSignal;
};

export async function runRunwayMotion(opts: RunRunwayMotionOpts): Promise<string> {
  // Runway only accepts 5 or 10 second clips
  const duration = opts.durationSeconds >= 8 ? 10 : 5;
  const ratio = aspectToRatio(opts.model, opts.aspect);

  const submit = await fetch("/api/runway/generate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiToken}`,
      "Content-Type": "application/json",
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: RUNWAY_MODEL_NAMES[opts.model],
      promptImage: opts.firstFrameUrl,
      promptText: opts.prompt,
      ratio,
      duration,
    }),
  });

  if (!submit.ok) {
    let detail = `HTTP ${submit.status}`;
    try {
      const body = await submit.json();
      if (body?.error) detail = body.error;
    } catch {
      // keep status code
    }
    throw new Error(`Runway submit failed: ${detail}`);
  }
  const created = (await submit.json()) as { id: string };
  if (!created.id) throw new Error("Runway submit returned no task id");

  let attempt = 0;
  while (true) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    attempt += 1;
    const wait = Math.min(4000, 1500 + attempt * 250);
    await new Promise((r) => setTimeout(r, wait));

    const poll = await fetch(`/api/runway/task/${encodeURIComponent(created.id)}`, {
      headers: { Authorization: `Bearer ${opts.apiToken}` },
      signal: opts.signal,
    });
    if (!poll.ok) {
      let detail = `HTTP ${poll.status}`;
      try {
        const body = await poll.json();
        if (body?.error) detail = body.error;
      } catch {
        // keep status code
      }
      throw new Error(`Runway poll failed: ${detail}`);
    }
    const task = (await poll.json()) as Task;
    if (task.status === "SUCCEEDED") {
      const url = task.output?.[0];
      if (!url) throw new Error("Runway succeeded but returned no output URL");
      recordModelSpend(opts.model, duration);
      return url;
    }
    if (task.status === "FAILED" || task.status === "CANCELLED") {
      throw new Error(task.failure ?? `Runway task ${task.status}`);
    }
    // PENDING / RUNNING / THROTTLED — keep polling
  }
}
