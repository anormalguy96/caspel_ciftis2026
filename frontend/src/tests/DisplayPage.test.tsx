import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/**
 * Page A — the exhibition display.
 *
 * The screen runs unattended for hours with nobody watching it, so the tests
 * that matter most are the ones about what happens when something goes wrong:
 * autoplay refused, the film failing to load, a visitor walking away mid-scan.
 *
 * The single most consequential assertion here is the QR target. This route is
 * /display; a code generated from the current URL would send every visitor at
 * the stand to the kiosk page instead of the mobile hub, and nobody would
 * notice until the exhibition opened.
 */

// Hoisted alongside the vi.mock factories below, which run before any
// top-level const in this file is initialised.
const { PUBLIC_URL } = vi.hoisted(() => ({ PUBLIC_URL: 'https://ciftis.caspel.com' }));

vi.mock('../services/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  getSessionId: () => 'test-session',
}));

vi.mock('../config/paths', async () => {
  const actual = await vi.importActual<typeof import('../config/paths')>('../config/paths');
  return { ...actual, PUBLIC_URL };
});

vi.mock('../assets/caspel.mp4', () => ({ default: '/assets/caspel-hashed.mp4' }));

import { DisplayPage } from '../pages/DisplayPage';

function renderDisplay() {
  return render(
    <MemoryRouter initialEntries={['/display']}>
      <DisplayPage />
    </MemoryRouter>
  );
}

/** happy-dom does not implement media playback; record the calls instead. */
let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  playSpy = vi.fn(() => Promise.resolve());
  pauseSpy = vi.fn();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: playSpy,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    writable: true,
    value: pauseSpy,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function openOverlay(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('kiosk-video').parentElement as HTMLElement);
  return screen.findByRole('dialog');
}

// ==========================================================================
// 1-2. The film
// ==========================================================================

describe('Page A renders the exhibition film', () => {
  it('renders the configured video asset', () => {
    renderDisplay();
    const video = screen.getByTestId('kiosk-video') as HTMLVideoElement;

    expect(video.tagName).toBe('VIDEO');
    expect(video.getAttribute('src')).toBe('/assets/caspel-hashed.mp4');
  });

  it('autoplays muted, loops, and plays inline', () => {
    renderDisplay();
    const video = screen.getByTestId('kiosk-video') as HTMLVideoElement;

    expect(video).toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('loop');
    expect(video).toHaveAttribute('playsinline');
    expect(video.muted || video.hasAttribute('muted')).toBe(true);
  });

  it('shows no native media controls', () => {
    renderDisplay();
    const video = screen.getByTestId('kiosk-video') as HTMLVideoElement;

    expect(video).not.toHaveAttribute('controls');
    expect(video.controls).toBe(false);
  });
});

// ==========================================================================
// 3-4. Tap opens the QR and pauses the film
// ==========================================================================

describe('Tapping the screen hands off to Page B', () => {
  it('opens the QR overlay on click', async () => {
    const user = userEvent.setup();
    renderDisplay();

    const dialog = await openOverlay(user);

    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('kiosk-qr')).toBeInTheDocument();
  });

  it('pauses the film while the QR is shown', async () => {
    const user = userEvent.setup();
    renderDisplay();

    await openOverlay(user);

    expect(pauseSpy).toHaveBeenCalled();
  });
});

// ==========================================================================
// 5-8. The QR target — the assertion that matters most
// ==========================================================================

describe('The QR encodes Page B and nothing else', () => {
  it('encodes exactly VITE_PUBLIC_URL', async () => {
    const user = userEvent.setup();
    renderDisplay();
    await openOverlay(user);

    expect(screen.getByTestId('kiosk-qr')).toHaveAttribute('data-qr-value', PUBLIC_URL);
  });

  it('targets the subdomain address in Mode A', async () => {
    const user = userEvent.setup();
    renderDisplay();
    await openOverlay(user);

    expect(screen.getByTestId('kiosk-qr')).toHaveAttribute('data-qr-value', 'https://ciftis.caspel.com');
  });

  it('never encodes the kiosk route itself', async () => {
    const user = userEvent.setup();
    renderDisplay();
    await openOverlay(user);

    const value = screen.getByTestId('kiosk-qr').getAttribute('data-qr-value') ?? '';
    expect(value).not.toContain('/display');
    expect(value).not.toContain('localhost');
  });

  it('shows the address in readable text beside the code', async () => {
    const user = userEvent.setup();
    renderDisplay();
    await openOverlay(user);

    expect(screen.getAllByTestId('kiosk-url')[0]).toHaveTextContent('ciftis.caspel.com');
  });

  it('generates the code locally — no external QR service is contacted', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    renderDisplay();
    await openOverlay(user);

    // The code is an inline SVG, not a remote image.
    expect(screen.getByTestId('kiosk-qr').tagName.toLowerCase()).toBe('svg');
    expect(document.querySelectorAll('img[src*="chart.googleapis"], img[src*="qrserver"]')).toHaveLength(0);
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toMatch(/qr|chart\.googleapis/i);
    }
  });
});

// ==========================================================================
// 9-11. Dismissal
// ==========================================================================

describe('The overlay retires cleanly', () => {
  it('closes via the visible close control', async () => {
    const user = userEvent.setup();
    renderDisplay();
    await openOverlay(user);

    await user.click(screen.getByRole('button', { name: /close/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderDisplay();
    await openOverlay(user);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('resumes the film after dismissal', async () => {
    const user = userEvent.setup();
    renderDisplay();
    await openOverlay(user);
    playSpy.mockClear();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(playSpy).toHaveBeenCalled());
  });

  it('dismisses itself after the inactivity timeout', async () => {
    vi.useFakeTimers();
    renderDisplay();
    // fireEvent, not userEvent: userEvent schedules its own real timers and
    // deadlocks against vi.useFakeTimers.
    await act(async () => {
      fireEvent.click(screen.getByTestId('kiosk-video').parentElement as HTMLElement);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // A visitor who walks away must not hold the screen for the next one.
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(playSpy).toHaveBeenCalled();
  });
});

// ==========================================================================
// 12-13. Failure modes
// ==========================================================================

describe('Page A fails usefully', () => {
  it('offers a touch-to-start state when autoplay is refused', async () => {
    playSpy.mockImplementation(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
    renderDisplay();

    // Never a black screen: the operator is told what to do.
    expect(await screen.findByTestId('kiosk-touch-to-start')).toBeInTheDocument();
  });

  it('shows the QR and address directly when the film cannot load', async () => {
    renderDisplay();
    const video = screen.getByTestId('kiosk-video');

    await act(async () => {
      video.dispatchEvent(new Event('error'));
    });

    const fallback = await screen.findByTestId('kiosk-video-fallback');
    expect(fallback).toBeInTheDocument();
    // The handoff survives the media failure — that is the whole point.
    expect(screen.getByTestId('kiosk-qr')).toHaveAttribute('data-qr-value', PUBLIC_URL);
    expect(screen.getByTestId('kiosk-url')).toHaveTextContent('ciftis.caspel.com');
  });

  it('respects reduced motion through the shared token system', async () => {
    const user = userEvent.setup();
    renderDisplay();
    const dialog = await openOverlay(user);

    // The entrance is the tokenised utility, which the global
    // prefers-reduced-motion block collapses along with every other animation.
    expect(dialog).toHaveClass('u-qr-enter');
  });
});

// ==========================================================================
// 14-15. Accessibility and containment
// ==========================================================================

describe('The overlay is a real dialog', () => {
  it('is labelled and modal, with focus moved into it', async () => {
    const user = userEvent.setup();
    renderDisplay();
    const dialog = await openOverlay(user);

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId as string)).toBeTruthy();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('does not render the Page B header or navigation', () => {
    renderDisplay();

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
