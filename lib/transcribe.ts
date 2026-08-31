"use client";

// The "AI listens to the video" half of the storyboard flow — the audio
// counterpart of lib/digest.ts. The dropped video's audio track is extracted
// locally with the shared ffmpeg.wasm singleton, sent to ElevenLabs Scribe
// with the user's own key, and the word timings are grouped into VO-sized
// transcript segments on the same clock the digest shots use.

import type { TranscriptSegment } from "./types";
import { ensureFFmpeg } from "./render";
import { runElevenLabsSTT, type STTWord } from "./elevenlabs";

/** Silence between consecutive words that starts a new segment, in seconds. */
const GAP_S = 0.8;
/** Segment length after which sentence-ending punctuation splits it. */
const SENTENCE_MIN_CHARS = 40;
/** Hard ceilings — a segment never grows past these. */
const MAX_SEGMENT_S = 12;
const MAX_SEGMENT_CHARS = 200;

export type TranscribeProgress = {
  pct: number;
  message: string;
};

export type TranscribeOptions = {
  file: File;
  apiKey: string;
  onProgress?: (p: TranscribeProgress) => void;
  signal?: AbortSignal;
};

function newId(prefix: string): string {
  const u =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${u.slice(0, 8)}`;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** How long the extracted audio runs, via an <audio> element; 0 on failure. */
async function probeAudioDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<number>((resolve) => {
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.src = url;
      audio.addEventListener(
        "loadedmetadata",
        () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0),
        { once: true },
      );
      audio.addEventListener("error", () => resolve(0), { once: true });
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Group word timings into VO-sized segments. A new segment starts on a
 * silence gap over GAP_S, after sentence-ending punctuation once the segment
 * has SENTENCE_MIN_CHARS of text, or when adding the next word would push it
 * past MAX_SEGMENT_S / MAX_SEGMENT_CHARS.
 */
export function groupWords(words: STTWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: STTWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const text = current.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
    const start = current[0].start_s;
    const end = current[current.length - 1].end_s;
    current = [];
    if (!text) return;
    segments.push({
      id: newId("vo"),
      text,
      start_s: round2(start),
      duration_s: Math.max(0.5, round2(end - start)),
    });
  };

  for (const word of words) {
    if (current.length > 0) {
      const prev = current[current.length - 1];
      const text = current.map((w) => w.text).join(" ");
      const breakOnGap = word.start_s - prev.end_s > GAP_S;
      const breakOnSentence = /[.!?]$/.test(prev.text) && text.length > SENTENCE_MIN_CHARS;
      const breakOnSize =
        word.end_s - current[0].start_s > MAX_SEGMENT_S ||
        text.length + 1 + word.text.length > MAX_SEGMENT_CHARS;
      if (breakOnGap || breakOnSentence || breakOnSize) flush();
    }
    current.push(word);
  }
  flush();
  return segments;
}

/**
 * Transcribe the video's narration: extract the audio track locally, send it
 * to ElevenLabs Scribe, group the words into transcript segments. A video
 * with no audio track (or one ffmpeg can't pull audio from) resolves to []
 * rather than throwing; aborts surface as a DOMException "AbortError".
 */
export async function transcribeVideo(opts: TranscribeOptions): Promise<TranscriptSegment[]> {
  const { file, apiKey, onProgress, signal } = opts;
  throwIfAborted(signal);

  onProgress?.({ pct: 5, message: "Loading ffmpeg.wasm engine…" });
  const { ffmpeg, fetchFile } = await ensureFFmpeg();
  throwIfAborted(signal);

  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "mp4";
  const inName = `stt_in.${ext}`;
  const outName = "stt_out.mp3";

  let audio: Blob | null = null;
  try {
    onProgress?.({ pct: 15, message: "Extracting audio track…" });
    await ffmpeg.writeFile(inName, await fetchFile(file));
    throwIfAborted(signal);

    // -vn drops the picture. A video with no audio track leaves no usable
    // output; that resolves to "no narration" below instead of throwing.
    try {
      await ffmpeg.exec(["-i", inName, "-vn", "-acodec", "libmp3lame", "-b:a", "96k", outName]);
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      // Copy out of the wasm heap — the underlying buffer gets reused.
      if (data.length > 0) audio = new Blob([new Uint8Array(data)], { type: "audio/mpeg" });
    } catch {
      audio = null;
    }
  } finally {
    for (const n of [inName, outName]) {
      try {
        await ffmpeg.deleteFile(n);
      } catch {
        // best effort — a leftover file only costs wasm heap until reload
      }
    }
  }

  throwIfAborted(signal);
  if (!audio) {
    onProgress?.({ pct: 100, message: "No audio track found." });
    return [];
  }

  onProgress?.({ pct: 45, message: "Transcribing narration…" });
  const result = await runElevenLabsSTT({ audio, apiKey, signal });
  throwIfAborted(signal);

  let segments: TranscriptSegment[];
  if (result.words.length > 0) {
    segments = groupWords(result.words);
  } else if (result.text.trim().length > 0) {
    // No word timings came back — one segment spanning the whole audio.
    const duration = await probeAudioDuration(audio);
    segments = [
      {
        id: newId("vo"),
        text: result.text.trim(),
        start_s: 0,
        duration_s: Math.max(0.5, round2(duration)),
      },
    ];
  } else {
    segments = [];
  }

  onProgress?.({
    pct: 100,
    message:
      segments.length === 0
        ? "No narration detected."
        : `${segments.length} transcript segment${segments.length === 1 ? "" : "s"}.`,
  });
  return segments;
}
