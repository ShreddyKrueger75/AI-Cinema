export type VoiceId =
  | "default"
  | "warm"
  | "cool"
  | "gravel";

const VOICE_MAP: Record<VoiceId, { id: string; label: string; description: string }> = {
  default: {
    id: "21m00Tcm4TlvDq8ikWAM",
    label: "Default (Rachel)",
    description: "Clear, calm, narration",
  },
  warm: {
    id: "ErXwobaYiN019PkySvjV",
    label: "Warm (Antoni)",
    description: "Friendly male, warm tone",
  },
  cool: {
    id: "EXAVITQu4vr4xnSDxMaL",
    label: "Cool (Bella)",
    description: "Soft female, even pace",
  },
  gravel: {
    id: "VR6AewLTigWG4xSOukaG",
    label: "Gravel (Arnold)",
    description: "Deep male, gritty",
  },
};

export function voiceList(): { value: VoiceId; label: string; description: string }[] {
  return Object.entries(VOICE_MAP).map(([value, info]) => ({
    value: value as VoiceId,
    label: info.label,
    description: info.description,
  }));
}

export function resolveVoiceId(voice: string): string {
  if (voice in VOICE_MAP) return VOICE_MAP[voice as VoiceId].id;
  return voice;
}

const BASE = "https://api.elevenlabs.io/v1";

export type RunVoiceOpts = {
  voice: string;
  text: string;
  apiKey: string;
  signal?: AbortSignal;
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Unexpected FileReader result"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

export type RunMusicOpts = {
  prompt: string;
  durationMs: number;
  apiKey: string;
  signal?: AbortSignal;
};

export async function runElevenLabsMusic(opts: RunMusicOpts): Promise<string> {
  const clampedMs = Math.min(60_000, Math.max(10_000, Math.round(opts.durationMs)));
  const r = await fetch(`${BASE}/music/compose?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": opts.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      prompt: opts.prompt,
      music_length_ms: clampedMs,
    }),
    signal: opts.signal,
  });
  if (!r.ok) {
    let body = "";
    try {
      body = await r.text();
    } catch {
      body = r.statusText;
    }
    throw new Error(`ElevenLabs Music ${r.status}: ${body.slice(0, 300)}`);
  }
  const blob = await r.blob();
  return blobToDataUrl(blob);
}

export type STTWord = {
  text: string;
  start_s: number;
  end_s: number;
};

export type STTResult = {
  text: string;
  /** Word-level timings, in seconds. Empty when the API sent none. */
  words: STTWord[];
};

export type RunSTTOpts = {
  audio: Blob;
  apiKey: string;
  signal?: AbortSignal;
};

/**
 * ElevenLabs Scribe speech-to-text. The documented response is
 * `{ language_code, text, words: [{ text, start, end, type }] }` with type
 * "word" | "spacing" and start/end in seconds — but it's parsed defensively:
 * a response carrying text without usable word timings still resolves, with
 * `words` empty, and spacing entries are dropped.
 */
export async function runElevenLabsSTT(opts: RunSTTOpts): Promise<STTResult> {
  const form = new FormData();
  form.append("file", opts.audio, "audio.mp3");
  form.append("model_id", "scribe_v1");
  const r = await fetch(`${BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": opts.apiKey },
    body: form,
    signal: opts.signal,
  });
  if (!r.ok) {
    let body = "";
    try {
      body = await r.text();
    } catch {
      body = r.statusText;
    }
    throw new Error(`ElevenLabs STT ${r.status}: ${body.slice(0, 300)}`);
  }

  let raw: unknown;
  try {
    raw = await r.json();
  } catch {
    throw new Error("ElevenLabs STT returned a non-JSON response.");
  }

  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text = typeof obj.text === "string" ? obj.text : "";
  const words: STTWord[] = [];
  if (Array.isArray(obj.words)) {
    for (const entry of obj.words) {
      if (!entry || typeof entry !== "object") continue;
      const w = entry as Record<string, unknown>;
      if (w.type === "spacing") continue;
      if (typeof w.text !== "string" || w.text.trim().length === 0) continue;
      if (typeof w.start !== "number" || !Number.isFinite(w.start)) continue;
      if (typeof w.end !== "number" || !Number.isFinite(w.end)) continue;
      words.push({ text: w.text.trim(), start_s: w.start, end_s: w.end });
    }
  }
  return { text, words };
}

export async function runElevenLabsTTS(opts: RunVoiceOpts): Promise<string> {
  const voiceId = resolveVoiceId(opts.voice);
  const r = await fetch(`${BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": opts.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: opts.text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true,
      },
    }),
    signal: opts.signal,
  });
  if (!r.ok) {
    let body = "";
    try {
      body = await r.text();
    } catch {
      body = r.statusText;
    }
    throw new Error(`ElevenLabs ${r.status}: ${body.slice(0, 300)}`);
  }
  const blob = await r.blob();
  return blobToDataUrl(blob);
}
