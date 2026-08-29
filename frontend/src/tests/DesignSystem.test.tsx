import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';

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
