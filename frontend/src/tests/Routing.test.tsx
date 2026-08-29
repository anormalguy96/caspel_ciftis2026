import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { ROUTE_DEFINITIONS } from '../App';
import { createSafeLoader, isChunkLoadError, clearReloadGuard } from '../utils/safeLazy';

/**
 * Two failures this file exists to prevent.
 *
 * Literal "/ciftis" routes were once declared alongside the "/ciftis"
 * basename. In Mode B that does not serve the hub -- it serves
 * /ciftis/ciftis, giving every page a second working address, and in Mode A it
 * publishes the whole site a second time under a prefix the subdomain does not
 * use. Both were reachable and rendered real pages.
 *
 * And a reload-on-failure recovery is one mistake away from an infinite reload
 * loop, or from hiding a genuine render bug behind a refresh.
 */

const routes = ROUTE_DEFINITIONS.map(({ path }) => ({ path }));

/** Which route id a URL resolves to, for a given deployment basename. */
function resolve(pathname: string, basename = '/'): string | null {
  const matches = matchRoutes(routes, { pathname }, basename);
  if (!matches?.length) return null;
  const matched = matches[matches.length - 1].route.path;
  return ROUTE_DEFINITIONS.find((r) => r.path === matched)?.id ?? null;
}

// ==========================================================================
// Canonical routing — Mode A
// ==========================================================================

describe('Mode A serves the hub at the domain root', () => {
  it('resolves the canonical routes', () => {
    expect(resolve('/')).toBe('landing');
    expect(resolve('/display')).toBe('display');
    expect(resolve('/product/erp')).toBe('product');
    expect(resolve('/presentation/erp')).toBe('presentation');
  });

  it('does not gain duplicate /ciftis/... routes', () => {
    for (const path of ['/ciftis', '/ciftis/', '/ciftis/display', '/ciftis/product/erp', '/ciftis/presentation/erp']) {
      expect(resolve(path)).toBe('catchAll');
    }
  });
});

// ==========================================================================
// Canonical routing — Mode B
// ==========================================================================

describe('Mode B serves the hub beneath the corporate path', () => {
  it('resolves the canonical routes through the basename', () => {
    expect(resolve('/ciftis/', '/ciftis')).toBe('landing');
    expect(resolve('/ciftis/display', '/ciftis')).toBe('display');
    expect(resolve('/ciftis/product/erp', '/ciftis')).toBe('product');
    expect(resolve('/ciftis/presentation/erp', '/ciftis')).toBe('presentation');
  });

  it('never renders a doubled /ciftis/ciftis path', () => {
    for (const path of [
      '/ciftis/ciftis',
      '/ciftis/ciftis/',
      '/ciftis/ciftis/display',
      '/ciftis/ciftis/product/erp',
      '/ciftis/ciftis/presentation/erp',
    ]) {
      expect(resolve(path, '/ciftis')).toBe('catchAll');
    }
  });

  it('keeps the kiosk deep link valid on refresh', () => {
    // A booth tablet is refreshed, not navigated to. Both modes must answer
    // the display route directly.
    expect(resolve('/display')).toBe('display');
    expect(resolve('/ciftis/display', '/ciftis')).toBe('display');
  });

  it('declares no literal /ciftis path anywhere in the table', () => {
    for (const { path } of ROUTE_DEFINITIONS) {
      expect(path).not.toMatch(/ciftis/i);
    }
  });
});

// ==========================================================================
// Stale-chunk recovery
// ==========================================================================

const chunkError = () => new Error('Failed to fetch dynamically imported module: /assets/ProductPage-a1b2c3.js');

describe('safeLazy recovers from a deployment landing mid-session', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearReloadGuard();
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
  });

  afterEach(() => {
    clearReloadGuard();
    vi.restoreAllMocks();
  });

  it('loads a healthy module and reloads nothing', async () => {
    const Component = () => null;
    const loader = createSafeLoader(async () => ({ ProductPage: Component }), 'ProductPage');

    await expect(loader()).resolves.toEqual({ default: Component });
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once when the chunk is genuinely gone', async () => {
    const loader = createSafeLoader(async () => { throw chunkError(); }, 'ProductPage');

    await expect(loader()).rejects.toThrow(/dynamically imported module/);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a second time if the chunk is still missing', async () => {
    const loader = createSafeLoader(async () => { throw chunkError(); }, 'ProductPage');

    await expect(loader()).rejects.toThrow();
    await expect(loader()).rejects.toThrow();
    await expect(loader()).rejects.toThrow();

    // The guard is what stands between recovery and a page that refreshes for ever.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('clears the guard after a successful load so a later deployment still recovers', async () => {
    const failing = createSafeLoader(async () => { throw chunkError(); }, 'ProductPage');
    await expect(failing()).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(1);

    const Component = () => null;
    const healthy = createSafeLoader(async () => ({ ProductPage: Component }), 'ProductPage');
    await healthy();

    await expect(failing()).rejects.toThrow();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not treat an application error as a stale chunk', async () => {
    const loader = createSafeLoader(async () => { throw new TypeError('Cannot read properties of undefined'); }, 'ProductPage');

    await expect(loader()).rejects.toThrow(TypeError);
    // Reloading here would hide a real bug behind a refresh.
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not treat a missing export as a stale chunk', async () => {
    const loader = createSafeLoader(async () => ({}), 'ProductPage');

    await expect(loader()).rejects.toThrow(/no "ProductPage" export/);
    expect(reload).not.toHaveBeenCalled();
  });

  it('recognises the chunk failures browsers actually emit, and nothing else', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('boom'), { name: 'ChunkLoadError' }))).toBe(true);

    expect(isChunkLoadError(new TypeError('undefined is not a function'))).toBe(false);
    expect(isChunkLoadError(new Error('Request failed with status 500'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
