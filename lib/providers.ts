"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ProviderId =
  | "pollinations"
  | "replicate"
  | "runway"
  | "elevenlabs"
  | "openai"
  | "anthropic"
  | "stability";

export type Provider = {
  id: ProviderId;
  name: string;
  surfaces: ("image" | "motion" | "voice" | "music" | "text")[];
  signup_url: string;
  key_prefix?: string;
  docs_url?: string;
  notes?: string;
  experimental?: boolean;
  optional?: boolean;
  relayed?: boolean;
};

export const PROVIDERS: Provider[] = [
  {
    id: "pollinations",
    name: "Pollinations",
    surfaces: ["image"],
    signup_url: "https://enter.pollinations.ai",
    notes: "Optional — bypass the free-tier IP queue (1 request/IP) for unlimited stills.",
    optional: true,
  },
  {
    id: "replicate",
    name: "Replicate",
    surfaces: ["image", "motion"],
    signup_url: "https://replicate.com/account/api-tokens",
    key_prefix: "r8_",
    notes: "Powers Flux 1.1 Pro, Flux Schnell, SDXL, Stable Audio. Relayed server-side (no CORS).",
    relayed: true,
  },
  {
    id: "runway",
    name: "Runway",
    surfaces: ["motion"],
    signup_url: "https://app.runwayml.com/settings/api",
    notes: "Gen-4 and Gen-3 img-to-video. Relayed server-side (no CORS).",
    relayed: true,
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    surfaces: ["voice", "music"],
    signup_url: "https://elevenlabs.io/app/settings/api-keys",
    notes: "TTS voices and Music",
  },
  {
    id: "stability",
    name: "Stability AI",
    surfaces: ["image"],
    signup_url: "https://platform.stability.ai/account/keys",
    key_prefix: "sk-",
  },
  {
    id: "openai",
    name: "OpenAI",
    surfaces: ["text", "image"],
    signup_url: "https://platform.openai.com/api-keys",
    key_prefix: "sk-",
    notes: "v2 — prompt-to-project scaffold",
    experimental: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    surfaces: ["text"],
    signup_url: "https://console.anthropic.com/settings/keys",
    key_prefix: "sk-ant-",
    notes: "v2 — prompt-to-project scaffold",
    experimental: true,
  },
];

const MODEL_TO_PROVIDER: Record<string, ProviderId> = {
  "pollinations": "pollinations",
  "flux-1.1-pro": "replicate",
  "flux-schnell": "replicate",
  "sdxl": "replicate",
  "ideogram-v2": "replicate",
  "minimax-video-01": "replicate",
  "runway-gen4": "runway",
  "runway-gen3": "runway",
  "pika-2.0": "replicate",
  "kling-2.0": "replicate",
  "luma-dream-machine": "replicate",
  "elevenlabs-music": "elevenlabs",
  "stable-audio": "replicate",
  "suno": "replicate",
};

export function providerForModel(modelId: string): ProviderId | null {
  return MODEL_TO_PROVIDER[modelId] ?? null;
}

export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${"•".repeat(Math.max(4, trimmed.length - 8))}${trimmed.slice(-4)}`;
}

export type ProviderKeysState = {
  keys: Partial<Record<ProviderId, string>>;
  setKey: (id: ProviderId, key: string) => void;
  removeKey: (id: ProviderId) => void;
  clearAll: () => void;
};

const STORAGE_KEY = "ai-cinema:provider-keys:v1";

export const useProviderKeys = create<ProviderKeysState>()(
  persist(
    (set) => ({
      keys: {},
      setKey: (id, key) =>
        set((state) => ({ keys: { ...state.keys, [id]: key.trim() } })),
      removeKey: (id) =>
        set((state) => {
          const next = { ...state.keys };
          delete next[id];
          return { keys: next };
        }),
      clearAll: () => set({ keys: {} }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 1,
    },
  ),
);

export function hasKey(state: ProviderKeysState, modelId: string): boolean {
  const p = providerForModel(modelId);
  if (!p) return false;
  return !!state.keys[p];
}
