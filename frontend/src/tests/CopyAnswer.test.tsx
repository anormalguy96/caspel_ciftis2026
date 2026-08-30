import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { CopyAnswerButton, buildCopyText } from '../components/CopyAnswerButton';
import type { ChatSource } from '../types';

const trackAnalyticsEvent = vi.hoisted(() => vi.fn());
vi.mock('../services/analytics', () => ({
  trackAnalyticsEvent,
  getSessionId: () => 'test-session',
}));

const SOURCES: ChatSource[] = [
  { document: 'CASPEL Corporate Presentation', page: 7, slug: 'caspel', product: 'caspel', score: 0.83 },
  { document: 'CASPEL ERP Presentation', page: 4, slug: 'erp', product: 'erp', score: 0.79 },
];

const fmt = (s: ChatSource) => `${s.document}, page ${s.page}`;

beforeEach(() => {
  trackAnalyticsEvent.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ==========================================================================
// What ends up on the clipboard
// ==========================================================================

describe('copied content', () => {
  it('carries the answer and a readable source list', () => {
    const text = buildCopyText('CASPEL has 20 years of experience.', SOURCES, 'Sources', fmt);
    expect(text).toContain('CASPEL has 20 years of experience.');
    expect(text).toContain('CASPEL Corporate Presentation, page 7');
    expect(text).toContain('CASPEL ERP Presentation, page 4');
  });

  it('carries no retrieval score, source id or internal metadata', () => {
    const text = buildCopyText('An answer.', SOURCES, 'Sources', fmt);
    expect(text).not.toContain('0.83');
    expect(text).not.toContain('0.79');
    expect(text).not.toMatch(/SOURCE_\d/);
    expect(text).not.toContain('slug');
    expect(text).not.toContain('caspel"');
    expect(text.toLowerCase()).not.toContain('session');
    expect(text.toLowerCase()).not.toContain('prompt');
    expect(text.toLowerCase()).not.toContain('api');
  });

  it('omits the source block entirely when there are no sources', () => {
    expect(buildCopyText('An answer.', [], 'Sources', fmt)).toBe('An answer.');
    expect(buildCopyText('An answer.', undefined, 'Sources', fmt)).toBe('An answer.');
  });

  it('trims the answer rather than copying stray whitespace', () => {
    expect(buildCopyText('  padded  ', undefined, 'Sources', fmt)).toBe('padded');
  });
});

// ==========================================================================
// Behaviour
// ==========================================================================

describe('copy control', () => {
  it('writes to the clipboard and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<CopyAnswerButton answer="An answer." sources={SOURCES} sourcesHeading="Sources" />);

    fireEvent.click(screen.getByTestId('copy-answer'));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('An answer.');
    await waitFor(() =>
      expect(screen.getByTestId('copy-answer')).toHaveAttribute('data-state', 'copied')
    );
  });

  it('records the action but never the copied text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<CopyAnswerButton answer="A secret answer." sources={SOURCES} sourcesHeading="Sources" />);
    fireEvent.click(screen.getByTestId('copy-answer'));

    // The handler awaits the clipboard write before recording, so the event
    // arrives a microtask later than the click.
    await waitFor(() => expect(trackAnalyticsEvent).toHaveBeenCalledWith('AI_ANSWER_COPIED'));
    const serialised = JSON.stringify(trackAnalyticsEvent.mock.calls);
    expect(serialised).not.toContain('A secret answer.');
  });

  it('falls back without looping when the clipboard is refused', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<CopyAnswerButton answer="An answer." sourcesHeading="Sources" />);
    fireEvent.click(screen.getByTestId('copy-answer'));

    await waitFor(() =>
      expect(screen.getByTestId('copy-answer')).toHaveAttribute('data-state', 'failed')
    );
    // One attempt per click; no automatic retry that would re-prompt.
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('survives a browser with no clipboard API at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    render(<CopyAnswerButton answer="An answer." sourcesHeading="Sources" />);
    fireEvent.click(screen.getByTestId('copy-answer'));

    await waitFor(() =>
      expect(screen.getByTestId('copy-answer')).toHaveAttribute('data-state', 'failed')
    );
  });

  it('announces the outcome in a live region', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { container } = render(
      <CopyAnswerButton answer="An answer." sourcesHeading="Sources" />
    );
    const status = container.querySelector('[role="status"]')!;
    expect(status).toHaveAttribute('aria-live', 'polite');

    fireEvent.click(screen.getByTestId('copy-answer'));
    await waitFor(() => expect(status.textContent).toBeTruthy());
  });

  it('has an accessible name and a tooltip', () => {
    render(<CopyAnswerButton answer="An answer." sourcesHeading="Sources" />);
    const button = screen.getByTestId('copy-answer');
    expect(button).toHaveAttribute('aria-label');
    expect(button).toHaveAttribute('title');
  });
});
