import { describe, it, expect } from 'vitest';
import { normalizeBasePath, assertSafeBasePath, validatePublicUrl } from '../config/basePath';

/**
 * The mount contract.
 *
 * The hub ships either at the root of its own subdomain or beneath /ciftis/ on
 * the corporate site, and the choice is baked in at build time. A wrong value
 * here produces a bundle whose every asset, link and canonical URL is subtly
 * off — and the printed QR code cannot be recalled. So the normaliser is tested
 * directly rather than inferred from a build.
 *
 * Two implementations exist by necessity: vite.config.ts runs in Node at build
 * time and must reject bad input loudly, while paths.ts runs in the browser and
 * only ever sees the already-validated value. These tests keep them agreeing.
 */

describe('base path normalisation', () => {
  it('normalises root to a single slash', () => {
    for (const input of ['/', '', '   ', undefined as unknown as string]) {
      expect(normalizeBasePath(input)).toBe('/');
      expect(assertSafeBasePath(input)).toBe('/');
    }
  });

  it('gives a nested base exactly one leading and one trailing slash', () => {
    for (const input of ['/ciftis', 'ciftis', '/ciftis/', 'ciftis/']) {
      expect(normalizeBasePath(input)).toBe('/ciftis/');
      expect(assertSafeBasePath(input)).toBe('/ciftis/');
    }
  });

  it('collapses repeated slashes inside the path', () => {
    expect(assertSafeBasePath('/events//ciftis//')).toBe('/events/ciftis/');
    expect(normalizeBasePath('/events//ciftis//')).toBe('/events/ciftis/');
  });

  it('supports a nested multi-segment base', () => {
    expect(assertSafeBasePath('/events/ciftis')).toBe('/events/ciftis/');
  });

  it('agrees with the browser-side normaliser on every accepted value', () => {
    for (const input of ['/', '/ciftis', 'ciftis/', '/events/ciftis', '/events//ciftis//']) {
      expect(normalizeBasePath(input)).toBe(assertSafeBasePath(input));
    }
  });
});

describe('base path validation rejects unsafe values', () => {
  it.each([
    ['an absolute URL', 'https://evil.example/ciftis'],
    ['a protocol-relative value', '//evil.example'],
    ['a leading double slash of any kind', '//ciftis/'],
    ['a traversal', '/ciftis/../admin/'],
    ['whitespace', '/cif tis'],
    ['a query string', '/ciftis?x=1'],
    ['a fragment', '/ciftis#frag'],
  ])('rejects %s', (_label, value) => {
    expect(() => assertSafeBasePath(value)).toThrow();
  });
});

describe('public URL validation', () => {
  it('accepts a subdomain deployment at the root', () => {
    expect(validatePublicUrl('https://ciftis.caspel.com', '/', true)).toBe(
      'https://ciftis.caspel.com'
    );
  });

  it('accepts a path deployment whose URL matches the base', () => {
    expect(validatePublicUrl('https://caspel.com/ciftis', '/ciftis/', true)).toBe(
      'https://caspel.com/ciftis'
    );
  });

  it('strips a trailing slash so joined URLs never double up', () => {
    expect(validatePublicUrl('https://ciftis.caspel.com/', '/', true)).toBe(
      'https://ciftis.caspel.com'
    );
  });

  it('rejects a public URL whose path disagrees with the base path', () => {
    // The exact mistake that yields https://caspel.com/ciftis/ciftis links.
    expect(() => validatePublicUrl('https://caspel.com/ciftis', '/', true)).toThrow(/does not match/);
    expect(() => validatePublicUrl('https://ciftis.caspel.com', '/ciftis/', true)).toThrow(
      /does not match/
    );
  });

  it('rejects loopback, http and missing values in production', () => {
    expect(() => validatePublicUrl('', '/', true)).toThrow(/not set/);
    expect(() => validatePublicUrl('http://caspel.com', '/', true)).toThrow(/https/);
    expect(() => validatePublicUrl('https://localhost:8080', '/', true)).toThrow(/loopback/);
  });

  it('keeps a documented default for local development', () => {
    expect(validatePublicUrl(undefined, '/', false)).toBe('http://localhost:5173');
  });
});
