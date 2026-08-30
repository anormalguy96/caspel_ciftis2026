import { describe, it, expect } from 'vitest';

import { citationPath, parsePageParam, clampPage } from '../utils/citationLink';
import { normalizeBasePath } from '../config/basePath';

// ==========================================================================
// Deep links to the exact cited page
// ==========================================================================

describe('citation deep links', () => {
  it('builds a route from the registry slug and page', () => {
    expect(citationPath({ slug: 'caspel', page: 7 })).toBe('/product/caspel?page=7&from=ai');
  });

  it('marks the navigation as coming from the assistant', () => {
    expect(citationPath({ slug: 'erp', page: 4 })).toContain('from=ai');
  });

  it('returns a router-relative path, never an absolute URL', () => {
    // React Router prefixes ROUTER_BASENAME itself. Building the base in here
    // as well produced "/ciftis/ciftis/product/..." in Mode B once already.
    const path = citationPath({ slug: 'erp', page: 4 })!;
    expect(path.startsWith('/product/')).toBe(true);
    expect(path).not.toMatch(/^https?:/);
  });

  it('resolves correctly under both deployment modes', () => {
    const path = citationPath({ slug: 'caspel', page: 7 })!;
    for (const raw of ['/', '/ciftis/']) {
      const base = normalizeBasePath(raw);
      const basename = base === '/' ? '' : base.slice(0, -1);
      const resolved = `${basename}${path}`;
      expect(resolved).toBe(raw === '/' ? '/product/caspel?page=7&from=ai' : '/ciftis/product/caspel?page=7&from=ai');
      expect(resolved).not.toContain('//product');
      expect(resolved).not.toContain('/ciftis/ciftis');
    }
  });

  it('refuses a slug that is not a plain identifier', () => {
    // Nothing here comes from the model, but a citation must never be able to
    // become a path traversal or an off-site link even if that changed.
    expect(citationPath({ slug: '../../etc/passwd', page: 1 })).toBeNull();
    expect(citationPath({ slug: 'https://evil.example', page: 1 })).toBeNull();
    expect(citationPath({ slug: 'a b', page: 1 })).toBeNull();
    expect(citationPath({ slug: '', page: 1 })).toBeNull();
    expect(citationPath({ slug: undefined, page: 1 })).toBeNull();
  });

  it('refuses a page that is not a positive integer', () => {
    expect(citationPath({ slug: 'caspel', page: 0 })).toBeNull();
    expect(citationPath({ slug: 'caspel', page: -3 })).toBeNull();
    expect(citationPath({ slug: 'caspel', page: 1.5 })).toBeNull();
    expect(citationPath({ slug: 'caspel', page: NaN })).toBeNull();
  });
});

// ==========================================================================
// Reading the page back off the URL
// ==========================================================================

describe('cited page parsing', () => {
  it('accepts a plain positive integer', () => {
    expect(parsePageParam('7')).toBe(7);
    expect(parsePageParam('1')).toBe(1);
  });

  it('rejects anything that is not one', () => {
    for (const bad of ['abc', '', '-3', '1.5', '1e9', ' 7 ', '07x', null]) {
      expect(parsePageParam(bad as string | null)).toBeNull();
    }
  });

  it('rejects an absurdly long numeric string rather than parsing it', () => {
    expect(parsePageParam('9'.repeat(20))).toBeNull();
  });

  it('clamps a requested page into the real document', () => {
    expect(clampPage(99, 24)).toBe(24);
    expect(clampPage(0, 24)).toBe(1);
    expect(clampPage(-5, 24)).toBe(1);
    expect(clampPage(7, 24)).toBe(7);
  });

  it('clamps safely when the page count is not yet known', () => {
    expect(clampPage(7, 0)).toBe(1);
    expect(clampPage(7, NaN)).toBe(1);
  });

  it('never returns a page past the end of the shorter deck', () => {
    // Corporate is 24 pages, ERP is 41. A link to page 30 of Corporate must
    // land on 24, not on a page that does not exist.
    expect(clampPage(30, 24)).toBe(24);
    expect(clampPage(30, 41)).toBe(30);
  });
});
