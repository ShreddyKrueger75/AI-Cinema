"use client";

import type { StateStorage } from "zustand/middleware";

/**
 * Content-addressed blob storage over IndexedDB, plus a zustand `StateStorage`
 * adapter that externalizes large data URLs at the persistence layer only.
 *
 * In-memory state keeps full data URLs (preview, render, and export are
 * untouched). Only what gets written to localStorage changes: on setItem,
 * large `data:` strings are swapped for small `idb:<sha256>` refs whose bytes
 * live in IndexedDB; on getItem, refs are re-inlined before zustand parses.
 *
 * Everything here fails soft: if IndexedDB or crypto.subtle is unavailable
 * (private-mode edge cases), data URLs stay inline and behavior degrades to
 * today's localStorage-only persistence.
 */

const DB_NAME = "ai-cinema-blobs";
const DB_VERSION = 1;
const OBJECT_STORE = "blobs";

export const BLOB_REF_PREFIX = "idb:";

/** Only externalize strings bigger than this — tiny thumbnails aren't worth a round trip. */
export const EXTERNALIZE_THRESHOLD = 16 * 1024;

const REF_PATTERN = /^idb:[0-9a-f]{64}$/;

/** Tolerant guard: true only for a well-formed `idb:<sha256-hex>` ref string. */
export function isBlobRef(s: unknown): s is string {
  return typeof s === "string" && REF_PATTERN.test(s);
}

/** A data URL big enough to be worth externalizing. */
export function isLargeDataUrl(s: unknown): s is string {
  return typeof s === "string" && s.startsWith("data:") && s.length > EXTERNALIZE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing (promise-wrapped, null on any failure)
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OBJECT_STORE)) {
          db.createObjectStore(OBJECT_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function requestValue<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(OBJECT_STORE, mode);
      const req = run(tx.objectStore(OBJECT_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet(hash: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  const value = await requestValue<unknown>(db, "readonly", (store) => store.get(hash));
  return value instanceof Blob ? value : null;
}

async function idbHas(hash: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  const count = await requestValue<number>(db, "readonly", (store) => store.count(hash));
  return (count ?? 0) > 0;
}

async function idbPut(hash: string, blob: Blob): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(OBJECT_STORE, "readwrite");
      tx.objectStore(OBJECT_STORE).put(blob, hash);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbKeys(): Promise<string[] | null> {
  const db = await openDb();
  if (!db) return null;
  const keys = await requestValue<IDBValidKey[]>(db, "readonly", (store) => store.getAllKeys());
  if (!keys) return null;
  return keys.filter((k): k is string => typeof k === "string");
}

async function idbDeleteMany(hashes: string[]): Promise<void> {
  const db = await openDb();
  if (!db || hashes.length === 0) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(OBJECT_STORE, "readwrite");
      const store = tx.objectStore(OBJECT_STORE);
      for (const hash of hashes) store.delete(hash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

async function sha256Hex(text: string): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const comma = dataUrl.indexOf(",");
    if (!dataUrl.startsWith("data:") || comma < 0) return null;
    const header = dataUrl.slice(5, comma);
    const payload = dataUrl.slice(comma + 1);
    const isBase64 = /;base64$/i.test(header);
    const mime = header.replace(/;base64$/i, "") || "application/octet-stream";
    if (!isBase64) {
      return new Blob([decodeURIComponent(payload)], { type: mime });
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Public blob API
// ---------------------------------------------------------------------------

// Hashes touched this session (put or deduped against). sweep() never deletes
// these, so a fire-and-forget sweep can't race a concurrent save that just
// wrote a blob whose ref hasn't landed in localStorage yet.
const sessionHashes = new Set<string>();

/**
 * Store a data URL as a Blob in IndexedDB and return its content-addressed
 * ref (`idb:<sha256-of-the-string>`). Content addressing gives free dedupe
 * across project, library, and versions — putting an existing hash is a
 * no-op. On any failure the original data URL is returned unchanged so the
 * caller can persist it inline (today's behavior).
 */
export async function putDataUrl(dataUrl: string): Promise<string> {
  try {
    const hash = await sha256Hex(dataUrl);
    if (!hash) return dataUrl;
    const ref = BLOB_REF_PREFIX + hash;
    if (await idbHas(hash)) {
      sessionHashes.add(hash);
      return ref;
    }
    const blob = dataUrlToBlob(dataUrl);
    if (!blob) return dataUrl;
    const ok = await idbPut(hash, blob);
    if (!ok) return dataUrl;
    sessionHashes.add(hash);
    return ref;
  } catch {
    return dataUrl;
  }
}

/** Resolve an `idb:` ref back to a data URL, or null if missing/unavailable. */
export async function resolveRef(ref: string): Promise<string | null> {
  if (!isBlobRef(ref)) return null;
  const blob = await idbGet(ref.slice(BLOB_REF_PREFIX.length));
  if (!blob) return null;
  return blobToDataUrl(blob);
}

/**
 * Delete every stored blob whose hash is not in `referencedRefs` (refs may be
 * passed with or without the `idb:` prefix). Hashes touched this session are
 * always kept. Safe to call fire-and-forget — never throws.
 */
export async function sweep(referencedRefs: Set<string>): Promise<void> {
  try {
    const keys = await idbKeys();
    if (!keys) return;
    const referenced = new Set<string>();
    referencedRefs.forEach((r) => {
      referenced.add(isBlobRef(r) ? r.slice(BLOB_REF_PREFIX.length) : r);
    });
    const stale = keys.filter((k) => !referenced.has(k) && !sessionHashes.has(k));
    await idbDeleteMany(stale);
  } catch {
    // fire-and-forget: sweep failures must never surface
  }
}

// ---------------------------------------------------------------------------
// zustand persist adapter
// ---------------------------------------------------------------------------

/**
 * Deep-walk a parsed JSON tree in place (the caller owns the copy) and
 * replace string values. `replace` returns the new string, or null to leave
 * the value untouched. Key order is preserved.
 */
async function walkStrings(node: unknown, replace: (value: string) => Promise<string | null>): Promise<void> {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === "string") {
        const next = await replace(v);
        if (next !== null) node[i] = next;
      } else {
        await walkStrings(v, replace);
      }
    }
    return;
  }
  if (typeof node === "object" && node !== null) {
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (typeof v === "string") {
        const next = await replace(v);
        if (next !== null) obj[key] = next;
      } else {
        await walkStrings(v, replace);
      }
    }
  }
}

/** Swap large data URLs for `idb:` refs. Works on a parsed copy of `json`, never live state. */
async function deflateJSON(json: string): Promise<string> {
  if (!json.includes("data:")) return json;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return json;
  }
  await walkStrings(parsed, async (value) => {
    if (!isLargeDataUrl(value)) return null;
    const ref = await putDataUrl(value);
    return ref === value ? null : ref;
  });
  return JSON.stringify(parsed);
}

/**
 * Re-inline `idb:` refs as data URLs. Pre-migration JSON (inline data URLs,
 * no refs) passes through byte-identical. A missing blob resolves to "" so
 * hydration never crashes.
 */
async function inflateJSON(json: string): Promise<string> {
  if (!json.includes(BLOB_REF_PREFIX)) return json;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return json;
  }
  await walkStrings(parsed, async (value) => {
    if (!isBlobRef(value)) return null;
    const dataUrl = await resolveRef(value);
    return dataUrl ?? "";
  });
  return JSON.stringify(parsed);
}

function readRaw(name: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

function writeRaw(name: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(name, value);
  } catch (e) {
    // A residual QuotaExceededError (or private-mode write failure) must not
    // throw back into zustand — the in-memory state stays intact either way.
    console.warn(`[blobstore] Failed to persist "${name}" to localStorage:`, e);
  }
}

// Writes are chained per key so overlapping async setItems land in call
// order (last write wins) instead of racing.
const writeChains = new Map<string, Promise<void>>();

function chainWrite(name: string, task: () => Promise<void>): Promise<void> {
  const prev = writeChains.get(name) ?? Promise.resolve();
  const next = prev.then(task, task).catch((e) => {
    console.warn(`[blobstore] Persist write for "${name}" failed:`, e);
  });
  writeChains.set(name, next);
  return next;
}

/**
 * Drop-in replacement for the `() => localStorage` passed to
 * `createJSONStorage`: same localStorage keys and JSON shape, except large
 * data URLs are externalized to IndexedDB on write and re-inlined on read.
 */
export const blobRefStateStorage: StateStorage = {
  getItem: async (name) => {
    const raw = readRaw(name);
    if (raw === null) return null;
    return inflateJSON(raw);
  },
  setItem: (name, value) =>
    chainWrite(name, async () => {
      writeRaw(name, await deflateJSON(value));
    }),
  removeItem: (name) =>
    chainWrite(name, async () => {
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(name);
      } catch {
        // ignore
      }
    }),
};

// ---------------------------------------------------------------------------
// Post-hydration garbage collection
// ---------------------------------------------------------------------------

// Every persisted store using blobRefStateStorage must be listed here (kept
// in sync with the STORAGE_KEYs in lib/store.ts and lib/library.ts). The
// sweep itself is computed from every "ai-cinema:*" localStorage key, so a
// store that adopts refs later can never have its blobs collected out from
// under it.
const SWEEP_HYDRATION_KEYS: readonly string[] = [
  "ai-cinema:project:v1",
  "ai-cinema:library:v1",
  "ai-cinema:project-library:v1",
];

const LOCAL_STORAGE_KEY_PREFIX = "ai-cinema:";

const hydratedStorageKeys = new Set<string>();
let sweepScheduled = false;

function collectRefsInto(json: string, into: Set<string>): void {
  for (const match of json.matchAll(/idb:[0-9a-f]{64}/g)) {
    into.add(match[0]);
  }
}

/**
 * Report that a persisted store finished hydrating. Once every store in
 * SWEEP_HYDRATION_KEYS has reported, fire-and-forget a sweep() of blobs no
 * longer referenced by the slimmed JSON in localStorage.
 */
export function markHydratedForSweep(storageKey: string): void {
  hydratedStorageKeys.add(storageKey);
  if (sweepScheduled) return;
  if (!SWEEP_HYDRATION_KEYS.every((k) => hydratedStorageKeys.has(k))) return;
  sweepScheduled = true;
  void (async () => {
    try {
      // Let any in-flight writes land so the refs we read are current.
      await Promise.all([...writeChains.values()]);
      const referenced = new Set<string>();
      if (typeof localStorage !== "undefined") {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith(LOCAL_STORAGE_KEY_PREFIX)) continue;
          collectRefsInto(readRaw(key) ?? "", referenced);
        }
      }
      await sweep(referenced);
    } catch {
      // fire-and-forget
    }
  })();
}
