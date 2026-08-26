import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestDemoModal } from '../components/RequestDemoModal';
import { CaspelAIModal } from '../components/CaspelAIModal';

vi.mock('../services/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  getSessionId: () => 'test-session',
}));

/**
 * A dialog is only a dialog if it behaves like one.
 *
 * These modals carried role="dialog" and aria-modal="true" while doing none of
 * what those attributes promise: Escape did nothing, focus stayed on the page
 * behind, Tab walked straight out of the panel into content the visitor could
 * not see, and the page underneath kept scrolling. On a phone opened from a QR
 * code that is the difference between usable and unusable.
 */

function Harness({
  Modal,
}: {
  Modal: React.FC<{ isOpen: boolean; onClose: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

const MODALS: Array<[string, React.FC<{ isOpen: boolean; onClose: () => void }>]> = [
  ['RequestDemoModal', RequestDemoModal],
  ['CaspelAIModal', CaspelAIModal],
];

beforeEach(() => {
  document.body.style.overflow = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
  );
});

describe.each(MODALS)('%s dialog behaviour', (_name, Modal) => {
  async function openDialog() {
    const user = userEvent.setup();
    render(<Harness Modal={Modal} />);
    const opener = screen.getByRole('button', { name: /open dialog/i });
    opener.focus();
    await user.click(opener);
    const dialog = await screen.findByRole('dialog');
    return { user, dialog, opener };
  }

  it('moves focus into the dialog when it opens', async () => {
    const { dialog } = await openDialog();

    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it('closes on Escape', async () => {
    const { user } = await openDialog();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('returns focus to the control that opened it', async () => {
    const { user, opener } = await openDialog();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });

  it('locks body scroll while open and restores it on close', async () => {
    const { user } = await openDialog();

    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(document.body.style.overflow).not.toBe('hidden');
    });
  });

  it('keeps Tab inside the dialog', async () => {
    const { user, dialog } = await openDialog();

    // Far more presses than the dialog has focusable children: without a trap
    // this walks out into the page behind.
    for (let i = 0; i < 25; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('keeps Shift+Tab inside the dialog', async () => {
    const { user, dialog } = await openDialog();

    for (let i = 0; i < 25; i += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes when the backdrop is clicked', async () => {
    const { user, dialog } = await openDialog();
    const backdrop = dialog.parentElement as HTMLElement;

    await user.click(backdrop);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('does not close when the panel itself is clicked', async () => {
    const { user, dialog } = await openDialog();

    await user.click(dialog);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('is labelled for assistive technology', async () => {
    const { dialog } = await openDialog();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId as string)).toBeTruthy();
  });
});

describe('CASPEL AI reports failure honestly', () => {
  async function openChat() {
    const user = userEvent.setup();
    render(<Harness Modal={CaspelAIModal} />);
    await user.click(screen.getByRole('button', { name: /open dialog/i }));
    await screen.findByRole('dialog');
    return user;
  }

  async function ask(user: ReturnType<typeof userEvent.setup>) {
    const input = screen.getByLabelText(/ask about caspel/i);
    await user.type(input, 'What is Caspel ERP?');
    await user.click(screen.getByRole('button', { name: /send message/i }));
  }

  it('shows a retryable unavailable state for a 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const user = await openChat();

    await ask(user);

    const failure = await screen.findByTestId('chat-failure');
    expect(failure).toHaveTextContent(/could not be reached/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('does not record a 503 as an assistant answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const user = await openChat();

    await ask(user);
    await screen.findByTestId('chat-failure');

    // The failure notice must not appear as a message in the transcript: the
    // whole point is that an outage is distinguishable from a reply.
    const log = screen.getByRole('log');
    expect(log.querySelectorAll('.chat__bubble--assistant')).toHaveLength(1); // greeting only
  });

  it('distinguishes a rate limit from an outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    const user = await openChat();

    await ask(user);

    expect(await screen.findByTestId('chat-failure')).toHaveTextContent(/lot of questions/i);
  });

  it('re-sends the question and shows the answer when Retry succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            answer: 'Caspel ERP consolidates finance and procurement.',
            sources: [{ document: 'CASPEL ERP Presentation', page: 7, product: 'erp' }],
            session_id: 'test-session',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const user = await openChat();
    await ask(user);
    await screen.findByTestId('chat-failure');

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(
      await screen.findByText(/consolidates finance and procurement/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId('chat-failure')).not.toBeInTheDocument();
    // Retry must not duplicate the visitor's question in the transcript.
    expect(screen.getAllByText('What is Caspel ERP?')).toHaveLength(1);
  });

  it('shows the answer with its cited sources on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            answer: 'Caspel ERP consolidates finance and procurement.',
            sources: [{ document: 'CASPEL ERP Presentation', page: 7, product: 'erp' }],
            session_id: 'test-session',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    const user = await openChat();

    await ask(user);

    expect(await screen.findByText(/CASPEL ERP Presentation — p.7/)).toBeInTheDocument();
  });
});
