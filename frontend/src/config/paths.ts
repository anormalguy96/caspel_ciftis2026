/**
 * Where this build is mounted, and every browser path derived from it.
 *
 * The hub can be deployed two ways and the choice is made at build time:
 *
 *   Mode A  https://ciftis.caspel.com/          base "/"
 *   Mode B  https://caspel.com/ciftis/          base "/ciftis/"
 *
 * Only one is served per deployment. Everything the browser requests — router
 * links, API calls, presentation streams, public assets, canonical metadata —
 * derives from the single value below, so selecting a mode is a rebuild with a
 * different environment, never a source edit.
 *
 * There is deliberately no hostname or path guessing at runtime. A bundle that
 * inferred its own mount point from `window.location` would behave differently
 * depending on which URL a visitor happened to arrive at, and would silently
 * produce wrong links the moment it sat behind a proxy that rewrote paths.
 */

/**
 * Vite guarantees BASE_URL matches the `base` it was built with, and that it
 * ends in a slash. vite.config.ts validates and normalises the raw environment
 * value before it ever reaches here, so this is already "/" or "/segment/".
 */
import { normalizeBasePath } from './basePath';

const RAW_BASE = import.meta.env.BASE_URL || '/';

/** Always exactly one leading and one trailing slash. Root is "/". */
export const BASE_PATH: string = normalizeBasePath(RAW_BASE);

export { normalizeBasePath };

/**
 * React Router wants a basename WITHOUT a trailing slash, except at root where
 * it wants "/". Passing "/ciftis/" makes every route match one slash short.
 */
export const ROUTER_BASENAME: string = BASE_PATH === '/' ? '/' : BASE_PATH.slice(0, -1);

/**
 * The absolute public URL of this deployment, no trailing slash.
 * Used for canonical/Open Graph metadata and the printed QR target.
 */
export const PUBLIC_URL: string = (import.meta.env.VITE_PUBLIC_URL || '').replace(/\/+$/, '');

/**
 * Join a root-relative path onto the base without ever doubling a slash.
 *
 * `path` is written as it appears in the application ("api/health",
 * "/api/health" — both accepted) and comes back mounted under the base.
 */
export function withBase(path: string): string {
  return `${BASE_PATH}${String(path).replace(/^\/+/, '')}`;
}

/** Browser URL for a backend endpoint, e.g. apiUrl('health') -> "/ciftis/api/health". */
export function apiUrl(path: string): string {
  return withBase(`api/${String(path).replace(/^\/+/, '')}`);
}

/** Absolute public URL for metadata and the QR code. */
export function publicUrl(path = ''): string {
  const suffix = String(path).replace(/^\/+/, '');
  return suffix ? `${PUBLIC_URL}/${suffix}` : PUBLIC_URL;
}
