/**
 * Base-path normalisation and public-URL validation.
 *
 * Shared by the build (vite.config.ts) and the browser bundle (paths.ts), so
 * the two can never disagree about where the app is mounted. It lives under
 * src/ rather than beside the Vite config because the tests import it, and a
 * test reaching into the composite Node-side project needs a built .d.ts that
 * a --noEmit typecheck never produces.
 *
 *   Mode A  https://ciftis.caspel.com/    base "/"
 *   Mode B  https://caspel.com/ciftis/    base "/ciftis/"
 *
 * Neither value is a secret; both appear verbatim in the shipped HTML.
 */

/** One leading slash, unreserved segments, one trailing slash. */
export const BASE_PATH_PATTERN = /^\/(?:[A-Za-z0-9][A-Za-z0-9._~-]*\/)*$/;

/**
 * Normalise an already-trusted base path. Never throws.
 *
 * The browser only ever sees a value the build already validated, and a throw
 * at module scope there would blank the page rather than report anything.
 */
export function normalizeBasePath(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed === '/') return '/';

  const collapsed = trimmed.replace(/\/{2,}/g, '/');
  const withLeading = collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/**
 * Validate and normalise a base path supplied by an operator. Throws on
 * anything unsafe — build time only, where failing loudly is the point.
 */
export function assertSafeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed === '/') return '/';

  if (/\s/.test(trimmed)) {
    throw new Error(`[caspel] VITE_APP_BASE_PATH contains whitespace: ${JSON.stringify(raw)}`);
  }
  // A leading "//" is protocol-relative and indistinguishable from a host, so
  // it is refused outright rather than collapsed into a path.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//')) {
    throw new Error(
      `[caspel] VITE_APP_BASE_PATH must be a path, not a URL or protocol-relative value: ${trimmed}`
    );
  }
  if (trimmed.includes('..')) {
    throw new Error(`[caspel] VITE_APP_BASE_PATH must not contain "..": ${trimmed}`);
  }

  const normalized = normalizeBasePath(trimmed);
  if (!BASE_PATH_PATTERN.test(normalized)) {
    throw new Error(
      `[caspel] VITE_APP_BASE_PATH is not a safe path: ${trimmed}. ` +
        'Use "/" or "/segment/" with unreserved characters only.'
    );
  }
  return normalized;
}

/**
 * Validate the absolute public address against the base path.
 *
 * The two describe the same mount point from different sides. If they disagree
 * every canonical link is wrong in a way nothing else would catch — and it is
 * exactly how a build ends up emitting https://caspel.com/ciftis/ciftis.
 */
export function validatePublicUrl(
  raw: string | undefined,
  basePath: string,
  isProduction: boolean
): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');

  if (!isProduction) return value || 'http://localhost:5173';

  if (!value) {
    throw new Error(
      '[caspel] VITE_PUBLIC_URL is not set. A production build must know its own public ' +
        'address: canonical, Open Graph and QR URLs are baked in at build time.'
    );
  }
  if (!/^https:\/\//i.test(value)) {
    throw new Error(`[caspel] VITE_PUBLIC_URL must be an https:// address, got: ${value}`);
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(value)) {
    throw new Error(
      `[caspel] VITE_PUBLIC_URL is ${value}, a loopback address. Shared links and the printed ` +
        'QR code would point at the build machine.'
    );
  }

  const path = new URL(value).pathname.replace(/\/+$/, '') || '/';
  const expected = basePath === '/' ? '/' : basePath.replace(/\/$/, '');
  if (path !== expected) {
    throw new Error(
      `[caspel] VITE_PUBLIC_URL path "${path}" does not match VITE_APP_BASE_PATH "${basePath}". ` +
        `Expected the URL to end at "${expected}".`
    );
  }
  return value;
}
