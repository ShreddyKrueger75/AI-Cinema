"use client";

// IndexedDB-backed asset store for blobs too large to persist in localStorage
// (imported videos, imported audio, Replicate motion outputs). Used for any
// asset whose persistence requirement exceeds the ~5–10 MB quota.
//
// URL scheme: `assetdb:<uuid>` is stored in `output_url` fields. At render
// time, components resolve the URI via `useAssetUrl()` which hydrates a
// fresh `blob:` URL for the current session.

const DB_NAME = "ai-cinema-assets";
const STORE = "blobs";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

export function isAssetUri(uri: string | null | undefined): uri is string {
  return typeof uri === "string" && uri.startsWith("assetdb:");
}

function assetIdFromUri(uri: string): string | null {
  if (!uri.startsWith("assetdb:")) return null;
  return uri.slice("assetdb:".length);
}

// Save a Blob (typically from `URL.createObjectURL`'s input) and return a
// stable URI you can persist in project state. Survives reloads, lives in
// IndexedDB (browser quota is per-origin, typically gigabytes).
export async function putAsset(blob: Blob): Promise<string> {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve(`assetdb:${id}`);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB put failed"));
  });
}

export async function getAsset(uri: string): Promise<Blob | null> {
  const id = assetIdFromUri(uri);
  if (!id) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
  });
}

export async function removeAsset(uri: string): Promise<void> {
  const id = assetIdFromUri(uri);
  if (!id) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
  });
}

// Session-scoped cache from assetdb:URI → blob:URL. The blob URLs are
// invalidated when the page reloads (which is when IndexedDB lookups
// re-create them), so we don't need TTL eviction.
const blobUrlCache = new Map<string, string>();

export async function resolveAssetUrl(uri: string): Promise<string> {
  if (!isAssetUri(uri)) return uri;
  const cached = blobUrlCache.get(uri);
  if (cached) return cached;
  const blob = await getAsset(uri);
  if (!blob) return uri;
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(uri, url);
  return url;
}

export function revokeCachedAssetUrl(uri: string): void {
  const url = blobUrlCache.get(uri);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrlCache.delete(uri);
  }
}

// Fetch a remote URL and stash the bytes in IndexedDB. Use for Replicate
// motion outputs whose signed URLs expire in ~24h — we download once at
// generation time and persist the blob locally.
export async function fetchToAsset(url: string, signal?: AbortSignal): Promise<string> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Fetch ${r.status} for ${url}`);
  const blob = await r.blob();
  return putAsset(blob);
}
