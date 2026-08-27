import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';

/**
 * The stand shows two marks and the relationship between them matters: this is
 * CASPEL's hub at CIFTIS, not a CIFTIS site. CASPEL must stay identifiable
 * wherever the event mark appears.
 *
 * An earlier release rule rejected any CIFTIS logo outright, because the only
 * way to produce one then was to redraw it. The event artwork is now supplied
 * and approved, so the rule is replaced rather than dropped: the logo is
 * checked for the things that can still go wrong -- a remote URL that dies
 * when the venue wifi does, a missing accessible name, and a reserved box of
 * the wrong shape that makes the header jump as the page loads.
 */

/** The PNG's own pixel dimensions; the reserved ratio must match these. */
const CIFTIS_INTRINSIC = { width: 297, height: 231 };

const renderHeader = () => render(<MemoryRouter><Header /></MemoryRouter>);
const renderFooter = () => render(<MemoryRouter><Footer /></MemoryRouter>);

describe('the approved CIFTIS mark appears beside CASPEL', () => {
  it('is present in the header', () => {
    renderHeader();
    expect(screen.getByRole('img', { name: 'CIFTIS 2026' })).toBeInTheDocument();
  });

  it('is present in the footer', () => {
    renderFooter();
    expect(screen.getByRole('img', { name: 'CIFTIS 2026' })).toBeInTheDocument();
  });

  it('carries an accessible name naming the event', () => {
    renderHeader();
    const logo = screen.getByRole('img', { name: 'CIFTIS 2026' });
    expect(logo).toHaveAttribute('alt', 'CIFTIS 2026');
    expect(logo.getAttribute('alt')).not.toBe('');
  });
});

describe('branding is served from the bundle, never from a third party', () => {
  it.each([
    ['header', renderHeader],
    ['footer', renderFooter],
  ])('loads every %s image from a local bundled asset', (_where, renderComponent) => {
    const { container } = renderComponent();
    const images = Array.from(container.querySelectorAll('img'));

    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      const src = img.getAttribute('src') ?? '';
      // A hotlinked mark is a stand that loses its branding when the hall wifi
      // drops, and a third party that can see every visitor's request.
      expect(src).not.toMatch(/^https?:\/\//i);
      expect(src).not.toMatch(/^\/\//);
      expect(src.length).toBeGreaterThan(0);
    }
  });
});

describe('the reserved layout box has the right shape', () => {
  it.each([
    ['header', renderHeader],
    ['footer', renderFooter],
  ])('reserves the intrinsic ratio in the %s so nothing stretches or jumps', (_where, renderComponent) => {
    renderComponent();
    const logo = screen.getByRole('img', { name: 'CIFTIS 2026' });

    const width = Number(logo.getAttribute('width'));
    const height = Number(logo.getAttribute('height'));

    expect(width).toBe(CIFTIS_INTRINSIC.width);
    expect(height).toBe(CIFTIS_INTRINSIC.height);

    const declared = width / height;
    const intrinsic = CIFTIS_INTRINSIC.width / CIFTIS_INTRINSIC.height;
    expect(Math.abs(declared - intrinsic)).toBeLessThan(0.001);
  });
});

describe('CASPEL remains the identity of the page', () => {
  it('shows the CASPEL wordmark in the header, ahead of the event mark', () => {
    const { container } = renderHeader();
    const images = Array.from(container.querySelectorAll('img'));
    const names = images.map((img) => img.getAttribute('alt'));

    expect(names).toContain('CASPEL');
    // CASPEL first in document order: the event accompanies the company.
    expect(names.indexOf('CASPEL')).toBeLessThan(names.indexOf('CIFTIS 2026'));
  });

  it('keeps the CASPEL wordmark in the footer', () => {
    renderFooter();
    expect(screen.getByRole('img', { name: 'CASPEL' })).toBeInTheDocument();
  });

  it('names CASPEL in the header link so the brand survives without images', () => {
    renderHeader();
    const brand = screen.getByRole('link', { name: /CASPEL/ });
    expect(brand).toBeInTheDocument();
    expect(within(brand).getByRole('img', { name: 'CASPEL' })).toBeInTheDocument();
  });
});
