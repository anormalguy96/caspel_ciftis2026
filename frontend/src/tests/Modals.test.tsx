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

/**
 * The assistant asks /api/chat/stream first and falls back to /api/chat when it
 * is absent. AI_STREAMING_ENABLED is false by default, so the honest fixture is
 * a 404 on the stream route and the intended response on the plain one.
 */
function stubChatFetch(plain: () => Response | Promise<Response>) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/chat/stream')) return new Response('', { status: 404 });
    return plain();
  });
  vi.stubGlobal('fetch', mock);
  return mock;
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
    await user.click(screen.getByRole('button', { name: /send question/i }));
  }

  it('recedes the ambient field once a conversation starts, rather than swapping canvas', async () => {
    stubChatFetch(() => new Response('', { status: 503 }));
    const user = await openChat();

    const ambient = screen.getByTestId('chat-ambient');
    expect(ambient).toHaveAttribute('data-state', 'idle');
    // Three colour fields and three rings. The count is asserted because it is
    // a deliberate budget rather than an aesthetic accident: every one of these
    // is a promoted, blurred compositor layer, and an exhibition phone pays for
    // each of them. Adding more stops reading as distinct light and starts
    // costing GPU memory.
    expect(ambient.querySelectorAll('.chat__ambient-field')).toHaveLength(3);
    expect(ambient.querySelectorAll('.chat__ambient-loop')).toHaveLength(3);
    expect(ambient.querySelectorAll('[class*="ambient-"]')).toHaveLength(6);
    expect(screen.getByRole('log')).toHaveAttribute('data-empty', 'true');

    await ask(user);

    await waitFor(() => {
      // The layer must NOT disappear. Unmounting it swapped a saturated field
      // for a differently-coloured light document mid-session, which read as
      // two products rather than two states of one. It recedes instead, and
      // its animation pauses so nothing moves behind long-form text.
      expect(screen.getByTestId('chat-ambient')).toBeInTheDocument();
      expect(screen.getByTestId('chat-ambient')).toHaveAttribute('data-state', 'receded');
      expect(screen.getByRole('log')).toHaveAttribute('data-empty', 'false');
    });
  });

  it('shows a retryable unavailable state for a 503', async () => {
    stubChatFetch(() => new Response('', { status: 503 }));
    const user = await openChat();

    await ask(user);

    const failure = await screen.findByTestId('chat-failure');
    expect(failure).toHaveTextContent(/could not be reached/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('does not record a 503 as an assistant answer', async () => {
    stubChatFetch(() => new Response('', { status: 503 }));
    const user = await openChat();

    await ask(user);
    await screen.findByTestId('chat-failure');

    // The failure notice must not appear as a message in the transcript: the
    // whole point is that an outage is distinguishable from a reply.
    const log = screen.getByRole('log');
    // No assistant transcript row at all: the assistant never replied, and
    // there is no scripted greeting standing in for one.
    expect(log.querySelectorAll('.chat__row--assistant')).toHaveLength(0);
  });

  it('distinguishes a rate limit from an outage', async () => {
    stubChatFetch(() => new Response('', { status: 429 }));
    const user = await openChat();

    await ask(user);

    expect(await screen.findByTestId('chat-failure')).toHaveTextContent(/lot of questions/i);
  });

  it('re-sends the question and shows the answer when Retry succeeds', async () => {
    // First attempt on the plain endpoint fails; the retry succeeds. The
    // stream route always 404s here, matching AI_STREAMING_ENABLED=false.
    let plainCalls = 0;
    stubChatFetch(() => {
      plainCalls += 1;
      if (plainCalls === 1) return new Response('', { status: 503 });
      return new Response(
        JSON.stringify({
          answer: 'Caspel ERP consolidates finance and procurement.',
          sources: [{ document: 'CASPEL ERP Presentation', page: 7, product: 'erp' }],
          session_id: 'test-session',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

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

    // Sources render as a footnote list, so the document title and its page
    // are separate elements. Both must survive exactly.
    const cited = await screen.findByText('CASPEL ERP Presentation');
    expect(cited.tagName).toBe('CITE');
    expect(cited.closest('li')).toHaveTextContent('p.7');
  });
});
