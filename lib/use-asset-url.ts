"use client";

import { useEffect, useState } from "react";
import { isAssetUri, resolveAssetUrl } from "./asset-store";

// Resolves any URL — including `assetdb:<uuid>` — to something a browser
// element (<video>, <img>, <audio>) can render. For non-assetdb inputs
// this is a pass-through. For assetdb URIs it returns a `blob:` URL after
// pulling the blob from IndexedDB, cached for the session.
export function useAssetUrl(url: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(
    isAssetUri(url) ? null : url ?? null,
  );

  useEffect(() => {
    if (!url) {
      setResolved(null);
      return;
    }
    if (!isAssetUri(url)) {
      setResolved(url);
      return;
    }
    let cancelled = false;
    resolveAssetUrl(url)
      .then((r) => {
        if (!cancelled) setResolved(r);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return resolved;
}
