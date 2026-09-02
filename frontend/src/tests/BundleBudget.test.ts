import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Deterministic bundle budget.
 *
 * Reads the emitted build rather than timing anything, so it gives the same
 * answer on every machine and in CI. Lighthouse numbers move with the runner's
 * mood; byte counts do not.
 *
 * The budget guards the *initial* path only -- what index.html tells the
 * browser to fetch before the visitor has done anything. Lazy chunks are
 * deliberately not budgeted: moving code into one is the point.
 *
 * If a legitimate change pushes a value over, raise the constant here in the
 * same commit and say why. The number is a tripwire, not a law.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Recorded from merged main (f5f3455) before this pass, in bytes. */
const BASELINE = {
  // Exact bytes from the emitted build, not vite's rounded kB display -- the
  // rounded figures were off by ~4 kB, which is larger than some real
  // regressions this check exists to catch.
  initialJs: 274_532, // index 105,346 + vendor 162,104 + icons 7,082
  initialCss: 68_848,
};

/** 5% headroom over what this pass actually achieves. */
const BUDGET = {
  initialJs: 268_000,
  initialCss: 74_000, // 70,097 actual; the new control and citation rules
};

function findDist(): string | null {
  for (const candidate of ['dist', join('..', 'dist')]) {
    const path = join(ROOT, candidate);
    if (existsSync(join(path, 'index.html'))) return path;
  }
  return null;
}

function initialAssets(dist: string): { js: string[]; css: string[] } {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  const names = refs.map((r) => r.split('/').pop()!).filter(Boolean);
  return {
    js: names.filter((n) => n.endsWith('.js')),
    css: names.filter((n) => n.endsWith('.css')),
  };
}

const bytes = (dist: string, name: string) => statSync(join(dist, 'assets', name)).size;

const dist = findDist();
/**
 * These read the emitted build, so they can only run once one exists. Locally
 * that means building first; in CI there is a dedicated step after the Mode A
 * build.
 *
 * The skip is announced rather than silent. A silently skipped budget keeps
 * the run green while enforcing nothing, which is exactly how this check was
 * passing in CI without ever executing.
 */
if (!dist) {
  // eslint-disable-next-line no-console
  console.warn(
    '[bundle-budget] no dist/ found - budget NOT enforced in this run. ' +
      'Build the frontend first to enforce it.'
  );
}

const describeIfBuilt = dist ? describe : describe.skip;

describeIfBuilt('initial bundle budget', () => {
  it('keeps the eagerly-loaded JavaScript inside budget', () => {
    const { js } = initialAssets(dist!);
    const total = js.reduce((n, f) => n + bytes(dist!, f), 0);
    expect(
      total,
      `Initial JS is ${total} bytes across ${js.join(', ')}. Budget is ${BUDGET.initialJs}. ` +
        'Move the new code behind a dynamic import, or raise the budget in this file ' +
        'and explain why in the same commit.'
    ).toBeLessThanOrEqual(BUDGET.initialJs);
  });

  it('keeps the eagerly-loaded CSS inside budget', () => {
    const { css } = initialAssets(dist!);
    const total = css.reduce((n, f) => n + bytes(dist!, f), 0);
    expect(total).toBeLessThanOrEqual(BUDGET.initialCss);
  });

  it('does not regress against the recorded merged-main baseline', () => {
    const { js } = initialAssets(dist!);
    const total = js.reduce((n, f) => n + bytes(dist!, f), 0);
    // The point of this pass was to make the first load smaller.
    expect(total).toBeLessThan(BASELINE.initialJs);
  });

  it('keeps the heavy features out of the initial path', () => {
    const html = readFileSync(join(dist!, 'index.html'), 'utf8');
    // Each of these is a real chunk in the build; none may be referenced by
    // index.html, because a visitor reading the product list needs none of them.
    for (const feature of ['pdf-', 'pdf.worker', 'CaspelAIModal', 'DisplayPage', 'qr-', '.mp4']) {
      expect(html, `${feature} must not be in the initial path`).not.toContain(feature);
    }
  });

  it('emits the heavy features as their own chunks rather than inlining them', () => {
    const assets = readdirSync(join(dist!, 'assets'));
    for (const feature of ['pdf-', 'pdf.worker', 'CaspelAIModal', 'DisplayPage']) {
      expect(
        assets.some((a) => a.startsWith(feature) || a.includes(feature)),
        `expected a separate ${feature} chunk`
      ).toBe(true);
    }
  });

  it('does not duplicate React or PDF.js across chunks', () => {
    const assets = readdirSync(join(dist!, 'assets')).filter((a) => a.endsWith('.js'));
    const withReactRuntime = assets.filter((a) => {
      const src = readFileSync(join(dist!, 'assets', a), 'utf8');
      // "Minified React error" only appears in React's own implementation.
      // Matching __SECRET_INTERNALS instead gives a false positive: a chunk
      // that merely consumes React from the vendor chunk references that
      // identifier too, so the naive check reported a duplication that does
      // not exist.
      return src.includes('Minified React error');
    });
    expect(withReactRuntime.length).toBeLessThanOrEqual(1);

    const withPdfCore = assets.filter((a) => {
      const src = readFileSync(join(dist!, 'assets', a), 'utf8');
      return src.includes('PDFDocumentLoadingTask');
    });
    expect(withPdfCore.length).toBeLessThanOrEqual(1);
  });

  /**
   * Every URL index.html tells the browser to fetch before anything else must
   * actually exist.
   *
   * index.html carried a hardcoded `<link rel="preload" href=".../fonts/Inter-var.woff2">`
   * for a file that was never there -- there is no `public/fonts` directory.
   * The SPA fallback answered with index.html, so the request returned 200 and
   * nothing looked broken; the browser silently discarded 2.7 KiB of HTML as
   * the wrong content type, and the font the stylesheet actually wanted was
   * still discovered late. A preload that costs a request on the critical path
   * and warms nothing is worse than no preload at all.
   *
   * Measured, not asserted from memory: the landing route showed two font
   * requests. This test fails on any preload whose target is not in the build.
   */
  it('preloads only files the build actually emits', () => {
    const html = readFileSync(join(dist!, 'index.html'), 'utf8');
    const hrefs = [...html.matchAll(/<link[^>]+rel="preload"[^>]*>/g)]
      .map((m) => /href="([^"]+)"/.exec(m[0])?.[1])
      .filter((h): h is string => Boolean(h));

    expect(hrefs.length, 'the font preload should be present').toBeGreaterThan(0);

    for (const href of hrefs) {
      // Strip the base path; both deployment modes resolve to the same file.
      const rel = href.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '');
      const withoutBase = rel.replace(/^ciftis\//, '');
      expect(existsSync(join(dist!, withoutBase)), `preload target missing: ${href}`).toBe(true);
    }
  });

  it('preloads the font the stylesheet actually requests', () => {
    const html = readFileSync(join(dist!, 'index.html'), 'utf8');
    const preloaded = /<link[^>]+rel="preload"[^>]+href="([^"]*\.woff2)"/.exec(html)?.[1];
    expect(preloaded, 'no font preload found').toBeTruthy();

    const cssFile = readdirSync(join(dist!, 'assets')).find((a) => a.endsWith('.css'));
    const css = readFileSync(join(dist!, 'assets', cssFile!), 'utf8');
    const fontName = preloaded!.split('/').pop()!;
    expect(css.includes(fontName), `css does not reference ${fontName}`).toBe(true);
  });
});
