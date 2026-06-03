"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, Promise<number[]>>();

export async function decodeWaveform(url: string, samples = 160): Promise<number[]> {
  if (cache.has(url)) return cache.get(url)!;
  const promise = (async () => {
    const AudioCtxCtor =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxCtor) throw new Error("No AudioContext");
    const ac = new AudioCtxCtor();
    try {
      const resp = await fetch(url);
      const buf = await resp.arrayBuffer();
      const audio = await ac.decodeAudioData(buf);
      const ch = audio.getChannelData(0);
      const blockSize = Math.max(1, Math.floor(ch.length / samples));
      const out: number[] = [];
      let peak = 0;
      for (let i = 0; i < samples; i++) {
        let max = 0;
        const base = i * blockSize;
        const end = Math.min(ch.length, base + blockSize);
        for (let j = base; j < end; j++) {
          const v = Math.abs(ch[j]);
          if (v > max) max = v;
        }
        out.push(max);
        if (max > peak) peak = max;
      }
      if (peak > 0) {
        for (let i = 0; i < out.length; i++) out[i] = out[i] / peak;
      }
      return out;
    } finally {
      try { ac.close(); } catch {}
    }
  })();
  cache.set(url, promise);
  promise.catch(() => cache.delete(url));
  return promise;
}

export function useWaveform(url: string | undefined | null, samples = 160): {
  data: number[] | null;
  error: string | null;
} {
  const [data, setData] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setData(null);
      setError(null);
      return;
    }
    setData(null);
    setError(null);
    decodeWaveform(url, samples)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [url, samples]);
  return { data, error };
}
