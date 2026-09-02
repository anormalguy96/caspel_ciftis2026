import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DownloadPresentationButton } from '../components/DownloadPresentationButton';
import en from '../locales/en.json';
import zh from '../locales/zh-CN.json';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const downloadPresentation = vi.hoisted(() => vi.fn());
vi.mock('../services/presentations', () => ({
  downloadPresentation,
  presentationStreamUrl: (slug: string) => `/api/presentations/${slug}/stream`,
  presentationDownloadUrl: (slug: string) => `/api/presentations/${slug}/download`,
}));

beforeEach(() => {
  downloadPresentation.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ==========================================================================
// Semantics and localization
// ==========================================================================

describe('download control semantics', () => {
  it('is a button with an accessible name', () => {
    render(<DownloadPresentationButton slug="caspel" filename="CASPEL.pdf" />);
    const button = screen.getByTestId('download-presentation');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-label');
  });

  it('has a label in both locales that is short enough not to wrap', () => {
    // A 50px control cannot hold a wrapped label; both must stay one line.
    expect(en.actions.download.length).toBeLessThanOrEqual(24);
    expect(zh.actions.download.length).toBeLessThanOrEqual(12);
    expect(en.actions.downloadStarted).toBeTruthy();
    expect(zh.actions.downloadStarted).toBeTruthy();
    expect(en.actions.downloadFailed).toBeTruthy();
    expect(zh.actions.downloadFailed).toBeTruthy();
  });

  it('announces the outcome in a live region', () => {
    const { container } = render(
      <DownloadPresentationButton slug="caspel" filename="CASPEL.pdf" />
    );
    const status = container.querySelector('[role="status"]');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });
});

// ==========================================================================
// Sizing contract, read from the stylesheet
// ==========================================================================

describe('sizing contract', () => {
  const css = readFileSync(join(SRC, 'styles', 'pages.css'), 'utf8');
  const rule = css.slice(
    css.indexOf('.viewer-bar__download {'),
    css.indexOf('.viewer-bar__download:active')
  );

  it('is 48-52px tall', () => {
    const match = rule.match(/min-block-size:\s*(\d+)px/);
    expect(match, 'expected an explicit min-block-size').toBeTruthy();
    const height = Number(match![1]);
    expect(height).toBeGreaterThanOrEqual(48);
    expect(height).toBeLessThanOrEqual(52);
  });

  it('clears the 44px interactive minimum by construction', () => {
    const height = Number(rule.match(/min-block-size:\s*(\d+)px/)![1]);
    expect(height).toBeGreaterThanOrEqual(44);
  });

  it('uses an 18-20px icon', () => {
    const iconRule = css.slice(
      css.indexOf('.viewer-bar__download-icon {'),
      css.indexOf('.viewer-bar__download-glyph {')
    );
    const size = Number(iconRule.match(/inline-size:\s*(\d+)px/)![1]);
    expect(size).toBeGreaterThanOrEqual(18);
    expect(size).toBeLessThanOrEqual(20);
  });

  it('never lets the label wrap', () => {
    expect(rule).toContain('white-space: nowrap');
  });

  it('does not become a full-width banner on mobile', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 560px)'));
    expect(mobile).toContain('max-inline-size');
  });

  it('uses logical properties for its own box', () => {
    expect(rule).toContain('padding-inline');
    expect(rule).toContain('min-block-size');
  });
});

// ==========================================================================
// States
// ==========================================================================

describe('download states', () => {
  it('starts at rest', () => {
    render(<DownloadPresentationButton slug="caspel" filename="CASPEL.pdf" />);
    expect(screen.getByTestId('download-presentation')).toHaveAttribute('data-state', 'idle');
  });

  it('confirms once the browser has taken over', async () => {
    render(<DownloadPresentationButton slug="caspel" filename="CASPEL.pdf" />);
    fireEvent.click(screen.getByTestId('download-presentation'));

    await waitFor(() =>
      expect(screen.getByTestId('download-presentation')).toHaveAttribute('data-state', 'started')
    );
    expect(downloadPresentation).toHaveBeenCalledWith('caspel', 'CASPEL.pdf');
  });

  it('reports a failure rather than appearing to do nothing', async () => {
    downloadPresentation.mockImplementation(() => {
      throw new Error('no anchor');
    });
    render(<DownloadPresentationButton slug="erp" filename="ERP.pdf" />);
    fireEvent.click(screen.getByTestId('download-presentation'));

    await waitFor(() =>
      expect(screen.getByTestId('download-presentation')).toHaveAttribute('data-state', 'failed')
    );
  });

  it('returns to rest after the confirmation, with no artificial delay first', () => {
    vi.useFakeTimers();
    render(<DownloadPresentationButton slug="caspel" filename="CASPEL.pdf" />);
    fireEvent.click(screen.getByTestId('download-presentation'));

    // The transfer is handed to the browser synchronously on click.
    expect(downloadPresentation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('download-presentation')).toHaveAttribute('data-state', 'started');

    // waitFor polls on real timers and would deadlock here, so the timer is
    // advanced inside act() and the result asserted directly.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('download-presentation')).toHaveAttribute('data-state', 'idle');
  });

  it('counts the download without recording visitor content', () => {
    const onDownloaded = vi.fn();
    render(
      <DownloadPresentationButton slug="caspel" filename="CASPEL.pdf" onDownloaded={onDownloaded} />
    );
    fireEvent.click(screen.getByTestId('download-presentation'));
    expect(onDownloaded).toHaveBeenCalledTimes(1);
    expect(onDownloaded).toHaveBeenCalledWith();
  });

  it('uses the verified endpoint and the official filename', () => {
    render(<DownloadPresentationButton slug="erp" filename="CASPEL_ERP_Presentation.pdf" />);
    fireEvent.click(screen.getByTestId('download-presentation'));
    // The service owns the URL; the component must not build one itself.
    expect(downloadPresentation).toHaveBeenCalledWith('erp', 'CASPEL_ERP_Presentation.pdf');
  });

  it('clears its timer on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <DownloadPresentationButton slug="caspel" filename="CASPEL.pdf" />
    );
    fireEvent.click(screen.getByTestId('download-presentation'));
    unmount();
    // A timer firing into an unmounted tree is a React warning and a leak.
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });

  /**
   * The control must not resize when its label changes.
   *
   * The icon swap was already solved with a single grid cell, but the *label*
   * was not: "Download" becomes "Download started", and the button grew with
   * it. Measured across the responsive matrix, that was 54.3px of width change
   * in English and 44.6px in Chinese, moving the button's left edge by up to
   * 44px on a 360px-wide phone -- under the finger that had just pressed it.
   *
   * happy-dom does not lay out, so this asserts the mechanism rather than the
   * pixels: every label state is rendered into the same grid cell, so the
   * control is always as wide as its longest label. The pixel result is
   * verified separately by the responsive matrix.
   */
  it('reserves the width of every label state so the control cannot resize', () => {
    render(<DownloadPresentationButton slug="caspel" filename="CASPEL.pdf" />);
    const reserve = document
      .querySelector('[data-testid="download-presentation"]')!
      .querySelector('.viewer-bar__download-reserve')!;

    const reserved = [...reserve.children].map((c) => c.textContent);
    expect(reserved).toHaveLength(3);
    // The longest state must be among the reserved widths, or the control
    // still grows when it is reached.
    expect(reserved).toContain('Download started');
    expect(reserved).toContain('Download failed');
    expect(reserved).toContain('Download');
  });

  it('hides the reserved copies from assistive technology', () => {
    render(<DownloadPresentationButton slug="caspel" filename="CASPEL.pdf" />);
    const reserve = document.querySelector('.viewer-bar__download-reserve')!;
    // Three extra copies of the label would otherwise be read out on focus.
    expect(reserve.getAttribute('aria-hidden')).toBe('true');
  });

  it('announces the outcome once, through the live region', async () => {
    render(<DownloadPresentationButton slug="caspel" filename="CASPEL.pdf" />);
    fireEvent.click(screen.getByTestId('download-presentation'));

    const live = document.querySelector('[role="status"]')!;
    await waitFor(() => expect(live.textContent).toContain('Download started'));
    // The visible label changes too, but only the live region is announced.
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});
