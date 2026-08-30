import { lazy, type ComponentType } from 'react';

/**
 * Lazy route loading that survives a deployment landing mid-session.
 *
 * When a new build is published, the content-hashed chunk a loaded page still
 * references stops existing. The next route change then fails with a network
 * error rather than a render error, and the visitor sees a blank panel. One
 * reload fixes it, because index.html is served uncached and points at the new
 * hashes.
 *
 * Two things make that safe rather than a reload loop. Only genuine chunk
 * fetch failures qualify -- a component that throws while rendering is a real
 * bug and must surface, not be papered over by a refresh that hides it. And a
 * session-scoped guard allows exactly one reload: if the chunk is still
 * missing afterwards the error is reported instead of reloading again.
 */

const RELOAD_GUARD_KEY = 'caspel:chunk-reload';

/**
 * Browsers word this differently and none of them expose a stable error code,
 * so matching is by the phrasing each engine actually emits for a dynamic
 * import whose file is gone.
 */
const CHUNK_ERROR_PATTERNS: RegExp[] = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
  /'?text\/html'? is not a valid javascript mime type/i,
];

/** True only for a missing-chunk failure, never for an application error. */
export function isChunkLoadError(error: unknown): boolean {
  if (error == null) return false;

  const candidate = error as { name?: unknown; message?: unknown };
  if (candidate.name === 'ChunkLoadError') return true;

  const message = typeof candidate.message === 'string' ? candidate.message : String(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function hasReloaded(): boolean {
  try {
    return window.sessionStorage.getItem(RELOAD_GUARD_KEY) === '1';
  } catch {
    // Storage disabled or partitioned. Report "already reloaded" so a browser
    // that cannot remember the guard can never be put into a reload loop.
    return true;
  }
}

function markReloaded(): void {
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
  } catch {
    /* nothing to do: hasReloaded() already fails closed */
  }
}

/** Clears the guard so a later deployment during the same session still recovers. */
export function clearReloadGuard(): void {
  try {
    window.sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    /* nothing to do */
  }
}

type ModuleRecord = Record<string, unknown>;

/**
 * The loader half of safeLazy, exported so the recovery behaviour can be
 * tested directly instead of through Suspense and an error boundary.
 */
export function createSafeLoader<T extends ComponentType<any>>(  // eslint-disable-line @typescript-eslint/no-explicit-any
  importFn: () => Promise<ModuleRecord>,
  exportName: string
): () => Promise<{ default: T }> {
  return async () => {
    try {
      const mod = await importFn();
      const component = (mod[exportName] ?? mod.default) as T | undefined;
      if (!component) {
        // A missing export is a build mistake, not a stale chunk. Throwing
        // here keeps it out of the recovery path below.
        throw new Error(`Module loaded but has no "${exportName}" export`);
      }
      clearReloadGuard();
      return { default: component };
    } catch (error) {
      if (isChunkLoadError(error) && !hasReloaded()) {
        markReloaded();
        window.location.reload();
      }
      throw error;
    }
  };
}

export function safeLazy<T extends ComponentType<any>>(  // eslint-disable-line @typescript-eslint/no-explicit-any
  importFn: () => Promise<ModuleRecord>,
  exportName: string
) {
  return lazy(createSafeLoader<T>(importFn, exportName));
}
