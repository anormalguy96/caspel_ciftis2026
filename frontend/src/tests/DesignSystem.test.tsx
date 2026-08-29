import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync } from 'node:fs';

import { ActionArrow } from '../components/ActionArrow';
import { Footer } from '../components/Footer';
import { CaspelAIEntry } from '../components/CaspelAIEntry';
import { ProductCard } from '../components/ProductCard';
import { CaspelAIModal } from '../components/CaspelAIModal';
import { PRODUCTS, localizeProduct } from '../config/products';

vi.mock('../services/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  getSessionId: () => 'test-session',
}));

beforeEach(() => {
  document.body.style.overflow = '';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
});

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** Which variant an arrow is, read from its geometry rather than a class. */
function variantOf(svg: Element): 'internal' | 'external' {
  const d = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d')).join(' ');
  // The external mark is a diagonal shaft plus a corner; the internal mark is
  // a horizontal shaft plus a chevron.
  return d.includes('M3 8h9.5') ? 'internal' : 'external';
}

// ==========================================================================
// Defect 4 — the arrow means what the control does
// ==========================================================================

describe('arrow direction follows behaviour, not label wording', () => {
  it('marks an in-product action as internal', () => {
    const { container } = wrap(<CaspelAIEntry onAsk={() => {}} />);
    // "Ask a question" opens the assistant overlay: it does not leave the site.
    const arrow = container.querySelector('.ai-entry__action .action-arrow');
    expect(arrow).toBeTruthy();
    expect(variantOf(arrow as Element)).toBe('internal');
  });

  it('marks a product route as internal', () => {
    // The copy is irrelevant here; only the arrow's meaning is under test.
    const product = localizeProduct(PRODUCTS.erp, (key) => key);
    const { container } = wrap(<ProductCard product={product} index={0} />);
    const arrow = container.querySelector('.action-arrow');
    expect(variantOf(arrow as Element)).toBe('internal');
  });

  it('marks every footer destination that leaves the site as external', () => {
    const { container } = wrap(<Footer />);
    const links = [...container.querySelectorAll('.site-footer__link')];
    expect(links.length).toBeGreaterThanOrEqual(3);

    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      const arrow = link.querySelector('.action-arrow');
      expect(href).not.toBe('');
      expect(arrow).toBeTruthy();
      // Website, LinkedIn and mailto all hand the visitor somewhere else.
      expect(variantOf(arrow as Element)).toBe('external');
    }
  });

  it('sends a mailto: to the mail client without opening a browser tab', () => {
    const { container } = wrap(<Footer />);
    const mail = [...container.querySelectorAll('a')].find((a) =>
      (a.getAttribute('href') ?? '').startsWith('mailto:')
    );
    expect(mail).toBeTruthy();
    // It leaves the experience (external arrow) but must NOT be target=_blank:
    // a mailto: in a new tab leaves an empty tab behind on every phone.
    expect(variantOf(mail!.querySelector('.action-arrow') as Element)).toBe('external');
    expect(mail).not.toHaveAttribute('target');
  });

  it('keeps decoration out of the accessibility tree', () => {
    const { container } = wrap(<ActionArrow direction="internal" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('renders no literal arrow glyph anywhere in visitor-facing JSX', () => {
    // Guards the rule at the source, not just at one render.
    for (const file of [
      'src/components/CaspelAIEntry.tsx',
      'src/components/CaspelAIModal.tsx',
      'src/components/Footer.tsx',
      'src/components/ProductCard.tsx',
      'src/pages/LandingPage.tsx',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/[→↗]/);
    }
  });
});

// ==========================================================================
// Defect 7 — the card and the overlay are one identity
// ==========================================================================

describe('landing entry and chat header share one badge', () => {
  it('uses the same mark asset in both places', () => {
    const { container: entry } = wrap(<CaspelAIEntry onAsk={() => {}} />);
    const entrySrc = entry.querySelector('.ai-entry__icon-img')?.getAttribute('src');

    const { container: chat } = wrap(<CaspelAIModal isOpen onClose={() => {}} />);
    const chatSrc = chat.querySelector('.chat__caspel-icon')?.getAttribute('src');

    expect(entrySrc).toBeTruthy();
    expect(entrySrc).toBe(chatSrc);
  });

  it('carries no iridescent orbit decoration around the mark', () => {
    const { container } = wrap(<CaspelAIEntry onAsk={() => {}} />);
    // The rainbow orb was four blurred spans; a duotone badge has none.
    expect(container.querySelectorAll('.ai-entry__signal-glow')).toHaveLength(0);
    expect(container.querySelectorAll('.ai-entry__signal-loop')).toHaveLength(0);
  });
});

describe('overlay open and close preserve focus', () => {
  function Harness() {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open assistant
        </button>
        <CaspelAIModal isOpen={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  it('returns focus to the exact invoker on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: /open assistant/i });
    opener.focus();
    await user.click(opener);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('opens from the keyboard', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: /open assistant/i });
    opener.focus();
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('locks the page behind the overlay', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /open assistant/i }));
    await screen.findByRole('dialog');

    expect(document.body.style.overflow).toBe('hidden');
  });
});

// ==========================================================================
// Stylesheet cascade — one authoritative rule per selector
// ==========================================================================

/**
 * Minimal CSS rule scanner, written for this audit rather than pulled in as a
 * dependency: the check is a handful of braces and a string state machine, and
 * a parser dependency would be a larger surface than the thing it verifies.
 *
 * Two mistakes made earlier versions of this audit useless, so both are
 * fixtured below:
 *
 *   1. A line-based scan reads the last line of a multi-line selector group
 *      (`.a,\n.b {`) as a rule of its own. It reported six duplicates that did
 *      not exist while missing every real one.
 *   2. Skipping comments during the scan is not enough. A rule's selector is
 *      the text back to the previous `}`, which normally includes the section
 *      comment above it — so `/* Hero *\/ .hero__inner` and `.hero__inner`
 *      hash differently and the duplicate slips through. Comments must be
 *      blanked out of the captured text, not merely stepped over.
 */

/** Replace comment bodies with spaces, preserving every byte offset. */
export function blankComments(css: string): string {
  const out = css.split('');
  let inComment = false;
  let inString: string | null = null;
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    const n = css[i + 1];
    if (inComment) {
      if (c === '*' && n === '/') { out[i] = ' '; out[i + 1] = ' '; i += 1; inComment = false; }
      else if (c !== '\n') out[i] = ' ';
      continue;
    }
    if (inString) {
      if (c === '\\') { i += 1; continue; }
      if (c === inString) inString = null;
      continue;
    }
    // A `/*` inside a string is not a comment.
    if (c === '/' && n === '*') { inComment = true; out[i] = ' '; out[i + 1] = ' '; i += 1; continue; }
    if (c === '"' || c === "'") inString = c;
  }
  return out.join('');
}

/**
 * Selector lists of every rule at the top level of the sheet. Rules nested in
 * an at-rule are a different cascade context and are deliberately excluded —
 * `.a {}` and `@media print { .a {} }` are not duplicates of each other.
 */
export function topLevelSelectors(css: string): string[] {
  const scan = blankComments(css);
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  let inString: string | null = null;

  for (let i = 0; i < scan.length; i += 1) {
    const c = scan[i];
    if (inString) {
      if (c === '\\') { i += 1; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'") { inString = c; continue; }

    if (c === '{') {
      if (depth === 0) {
        const sel = scan.slice(start, i).trim();
        if (sel && !sel.startsWith('@')) selectors.push(sel);
      }
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) start = i + 1;
      if (depth < 0) depth = 0;
    }
  }
  return selectors;
}

/** Whitespace- and order-insensitive key, so `.a, .b` and `.b,\n.a` match. */
export function selectorKey(selectorList: string): string {
  return selectorList
    .split(',')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .sort()
    .join(', ');
}

/**
 * `:root` is opened once per concern — palette, green ramp, focus, targets,
 * layering — each block carrying its own rationale. That is the documented
 * convention in ARCHITECTURE.md §2.7, not an accidental redefinition, and it
 * is the single exemption.
 */
const MULTI_BLOCK_BY_CONVENTION = new Set([':root']);

export function duplicateSelectors(css: string): Array<{ selector: string; count: number }> {
  const counts = new Map<string, number>();
  for (const sel of topLevelSelectors(css)) {
    const key = selectorKey(sel);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([sel, count]) => count > 1 && !MULTI_BLOCK_BY_CONVENTION.has(sel))
    .map(([selector, count]) => ({ selector, count }));
}

describe('the parser behind the audit', () => {
  it('treats a multiline selector group as one selector list', () => {
    const css = `
      .chat__ambient-field,
      .chat__ambient-loop {
        position: absolute;
      }
    `;
    expect(topLevelSelectors(css)).toEqual(['.chat__ambient-field,\n      .chat__ambient-loop']);
    expect(duplicateSelectors(css)).toEqual([]);
  });

  it('does not mistake the last line of a group for its own rule', () => {
    // The exact shape that made the line-based version report phantom duplicates.
    const css = `
      .a,
      .b { color: red; }

      .b { color: blue; }
    `;
    // .b appears once alone and once inside a group: those are different
    // selector lists, so neither is a duplicate of the other.
    expect(duplicateSelectors(css)).toEqual([]);
  });

  it('strips the section comment above a rule from its selector', () => {
    // The exact shape that made the comment-skipping version miss real ones.
    const css = `
      /* ── Hero ─────────────────── */

      .hero__inner { max-width: 60ch; }

      .hero__inner { max-width: 72rem; }
    `;
    expect(duplicateSelectors(css)).toEqual([{ selector: '.hero__inner', count: 2 }]);
  });

  it('does not treat a comment inside a string as a comment', () => {
    const css = `
      .a::before { content: "/* not a comment */"; }
      .b { color: red; }
    `;
    expect(topLevelSelectors(css)).toEqual(['.a::before', '.b']);
  });

  it('does not treat a brace inside a string as structure', () => {
    const css = `
      .a { content: "}"; }
      .a { color: red; }
    `;
    // Both rules really are .a. A scanner that let the quoted brace close the
    // rule would desynchronise and fold the stray `}` into the next
    // selector's text, so the two would no longer hash alike and the genuine
    // duplicate would go unreported.
    expect(duplicateSelectors(css)).toEqual([{ selector: '.a', count: 2 }]);
  });

  it('handles an escaped quote inside a string', () => {
    const css = `
      .a::before { content: '\\''; }
      .b { color: red; }
    `;
    expect(topLevelSelectors(css)).toEqual(['.a::before', '.b']);
  });

  it('keeps rules in different at-rule contexts distinct', () => {
    const css = `
      .a { color: red; }

      @media (min-width: 900px) {
        .a { color: blue; }
      }

      @supports (backdrop-filter: blur(1px)) {
        .a { color: green; }
      }
    `;
    expect(topLevelSelectors(css)).toEqual(['.a']);
    expect(duplicateSelectors(css)).toEqual([]);
  });

  it('resumes correctly after a nested at-rule block', () => {
    const css = `
      @media (min-width: 900px) {
        .a { color: blue; }
      }

      .c { color: red; }

      .c { color: green; }
    `;
    expect(duplicateSelectors(css)).toEqual([{ selector: '.c', count: 2 }]);
  });

  it('ignores selector part order and whitespace when comparing', () => {
    const css = `
      .a,
      .b { color: red; }

      .b,   .a { color: blue; }
    `;
    expect(duplicateSelectors(css)).toEqual([{ selector: '.a, .b', count: 2 }]);
  });

  it('exempts :root, which is opened once per concern by convention', () => {
    const css = `
      :root { --a: 1; }
      :root { --b: 2; }
      :root { --c: 3; }
    `;
    expect(duplicateSelectors(css)).toEqual([]);
  });

  it('still reports a genuine duplicate that is not :root', () => {
    const css = `
      :root { --a: 1; }
      :root { --b: 2; }
      .card { color: red; }
      .card { color: blue; }
    `;
    expect(duplicateSelectors(css)).toEqual([{ selector: '.card', count: 2 }]);
  });
});

describe('every application stylesheet defines each selector exactly once', () => {
  const SHEETS = [
    'components.css',
    'global.css',
    'kiosk.css',
    'modals.css',
    'motion.css',
    'pages.css',
    'tokens.css',
  ];

  it.each(SHEETS)('%s has no duplicate top-level selector list', (sheet) => {
    const css = readFileSync(`src/styles/${sheet}`, 'utf8');
    const dupes = duplicateSelectors(css);
    expect(
      dupes.map((d) => `${d.selector} x${d.count}`),
      `${sheet} redefines a selector already defined at the top level of the same ` +
        'file. Merge it into the rule that currently wins -- usually the later ' +
        'one, and always the later one when an @media block sits between them.'
    ).toEqual([]);
  });

  it('audits all seven sheets, so a new stylesheet cannot slip past unchecked', () => {
    const onDisk = readdirSync('src/styles').filter((f) => f.endsWith('.css')).sort();
    expect(onDisk).toEqual([...SHEETS].sort());
  });

  it('reports zero duplicates across the whole stylesheet set', () => {
    const total = SHEETS.reduce(
      (n, sheet) => n + duplicateSelectors(readFileSync(`src/styles/${sheet}`, 'utf8')).length,
      0
    );
    expect(total).toBe(0);
  });
});
