import { useCallback, useEffect, useState } from 'react';
import { ProductSlug } from '../types';
import {
  PresentationEntry,
  PresentationManifest,
  fetchPresentationManifest,
} from '../services/presentations';

export type ManifestStatus = 'loading' | 'ready' | 'error';

/**
 * Presentation availability, read from the server rather than hardcoded.
 *
 * The manifest is fetched once per page load and shared through a module-level
 * promise so the landing page's cards don't each issue their own request.
 *
 * A failed request is reported as `error`, never silently folded into "not
 * published". Those are different facts: one means CASPEL has not supplied the
 * deck, the other means this page could not reach the server. Telling a visitor
 * a deck does not exist because of a dropped Wi-Fi packet is a lie the UI is
 * not allowed to tell.
 */
let inflight: Promise<PresentationManifest> | null = null;
let cached: PresentationManifest | null = null;

function loadManifest(): Promise<PresentationManifest> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchPresentationManifest()
      .then((manifest) => {
        cached = manifest;
        return manifest;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Test seam: drop the cached manifest so the next call refetches. */
export function resetPresentationManifestCache(): void {
  cached = null;
  inflight = null;
}

export function usePresentationManifest() {
  const [manifest, setManifest] = useState<PresentationManifest | null>(cached);
  const [status, setStatus] = useState<ManifestStatus>(cached ? 'ready' : 'loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (!cached) setStatus('loading');

    loadManifest()
      .then((data) => {
        if (!active) return;
        setManifest(data);
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    resetPresentationManifestCache();
    setAttempt((n) => n + 1);
  }, []);

  const getEntry = useCallback(
    (slug: ProductSlug): PresentationEntry | undefined => manifest?.[slug],
    [manifest]
  );

  const isAvailable = useCallback(
    (slug: ProductSlug): boolean => manifest?.[slug]?.available ?? false,
    [manifest]
  );

  return { manifest, status, getEntry, isAvailable, retry };
}
