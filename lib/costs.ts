"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// Per-unit price ESTIMATES ONLY — provider pricing changes without notice and
// varies by tier, resolution, and hardware. Treat the meter as a rough gauge
// and check your provider dashboards (Replicate, Runway, ElevenLabs, Anthropic)
// for what you were actually billed.
export type PricingUnit = "image" | "clip" | "second" | "1k_chars" | "minute";

export type PricingEntry = {
  provider: string;
  kind: "image" | "motion" | "voice" | "music" | "vision";
  unit: PricingUnit;
  usd_per_unit: number;
};

export const PRICING: Record<string, PricingEntry> = {
  "flux-1.1-pro": { provider: "replicate", kind: "image", unit: "image", usd_per_unit: 0.04 },
  "flux-schnell": { provider: "replicate", kind: "image", unit: "image", usd_per_unit: 0.003 },
  "sdxl": { provider: "replicate", kind: "image", unit: "image", usd_per_unit: 0.01 },
  "ideogram-v2": { provider: "replicate", kind: "image", unit: "image", usd_per_unit: 0.08 },
  "minimax-video-01": { provider: "replicate", kind: "motion", unit: "clip", usd_per_unit: 0.5 },
  // Rough per-clip estimates for the other wired Replicate motion models (~5s clips).
  "kling-2.0": { provider: "replicate", kind: "motion", unit: "clip", usd_per_unit: 0.3 },
  "pika-2.0": { provider: "replicate", kind: "motion", unit: "clip", usd_per_unit: 0.45 },
  "luma-dream-machine": { provider: "replicate", kind: "motion", unit: "clip", usd_per_unit: 0.5 },
  "runway-gen4": { provider: "runway", kind: "motion", unit: "second", usd_per_unit: 0.05 },
  "runway-gen3": { provider: "runway", kind: "motion", unit: "second", usd_per_unit: 0.025 },
  "stable-audio": { provider: "replicate", kind: "music", unit: "clip", usd_per_unit: 0.02 },
  "elevenlabs-tts": { provider: "elevenlabs", kind: "voice", unit: "1k_chars", usd_per_unit: 0.1 },
  "elevenlabs-music": { provider: "elevenlabs", kind: "music", unit: "minute", usd_per_unit: 0.3 },
  "anthropic-vision": { provider: "anthropic", kind: "vision", unit: "image", usd_per_unit: 0.015 },
};

/** Estimated USD for `units` of `model` (units match the model's PRICING unit). */
export function estimateFor(model: string, units: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return p.usd_per_unit * units;
}

export type CostEvent = {
  id: string;
  provider: string;
  model: string;
  kind: PricingEntry["kind"];
  est_usd: number;
  at: number;
};

export type CostsState = {
  events: CostEvent[];
  recordSpend: (e: Omit<CostEvent, "id" | "at">) => void;
  totalUsd: () => number;
  byProvider: () => Record<string, number>;
  reset: () => void;
};

function newId(prefix: string): string {
  const u = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}_${u}`;
}

const MAX_EVENTS = 500;

const STORAGE_KEY = "ai-cinema:costs:v1";

export const useCosts = create<CostsState>()(
  persist(
    (set, get) => ({
      events: [],
      recordSpend: (e) =>
        set((state) => ({
          events: [...state.events, { ...e, id: newId("cost"), at: Date.now() }].slice(-MAX_EVENTS),
        })),
      totalUsd: () => get().events.reduce((sum, e) => sum + e.est_usd, 0),
      byProvider: () => {
        const totals: Record<string, number> = {};
        for (const e of get().events) {
          totals[e.provider] = (totals[e.provider] ?? 0) + e.est_usd;
        }
        return totals;
      },
      reset: () => set({ events: [] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 1,
    },
  ),
);

/**
 * Record a completed paid generation for `model`. Models without a PRICING
 * entry (pollinations, ken-burns, unknown) are skipped — they cost nothing
 * or we have no honest estimate for them.
 */
export function recordModelSpend(model: string, units: number): void {
  const p = PRICING[model];
  if (!p || p.usd_per_unit <= 0) return;
  useCosts.getState().recordSpend({
    provider: p.provider,
    model,
    kind: p.kind,
    est_usd: estimateFor(model, units),
  });
}
