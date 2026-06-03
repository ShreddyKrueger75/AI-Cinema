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
