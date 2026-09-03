import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { CaspelAIModal } from '../components/CaspelAIModal';
import { resetChatCapabilitiesCache } from '../services/chatStream';

const trackAnalyticsEvent = vi.hoisted(() => vi.fn());
vi.mock('../services/analytics', () => ({
  trackAnalyticsEvent,
  getSessionId: () => 'test-session',
}));

/** Build an SSE body from frames, optionally split at arbitrary byte offsets. */
function sseBody(frames: string[], byteSplits = false): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(frames.join(''));
  const pieces: Uint8Array[] = byteSplits
    ? [bytes.slice(0, Math.floor(bytes.length / 2)), bytes.slice(Math.floor(bytes.length / 2))]
    : frames.map((f) => encoder.encode(f));
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= pieces.length) {
        controller.close();
        return;
      }
      controller.enqueue(pieces[i++]);
    },
  });
}

const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

interface Routes {
  stream?: () => Response;
  plain?: () => Response;
  capabilities?: () => Response;
}

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

function stubRoutes({ stream, plain, capabilities }: Routes) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    // Default: streaming advertised, so the streaming tests below exercise the
    // streaming path. A deployment's real default is the opposite.
    if (url.includes('/chat/capabilities')) {
      return capabilities ? capabilities() : okJson({ streaming: true });
    }
    if (url.includes('/chat/stream')) {
      return stream ? stream() : new Response('', { status: 404 });
    }
    if (url.includes('/chat')) {
      return plain
        ? plain()
        : new Response(
            JSON.stringify({ answer: 'Plain answer.', sources: [], session_id: 's' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const okStream = (frames: string[], byteSplits = false) => () =>
  new Response(sseBody(frames, byteSplits), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

async function askQuestion(text = 'Which modules does Caspel ERP include?') {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest('form')!);
}

const wrap = () =>
  render(
    <MemoryRouter>
      <CaspelAIModal isOpen onClose={() => {}} />
    </MemoryRouter>
  );

beforeEach(() => {
  trackAnalyticsEvent.mockClear();
  document.body.style.overflow = '';
  // The capability answer is cached for the page's lifetime, which is correct
  // in the product and would leak between tests here.
  resetChatCapabilitiesCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ==========================================================================
// Happy path
// ==========================================================================

describe('streamed answer', () => {
  it('renders deltas into one assistant bubble and commits once', async () => {
    stubRoutes({
      stream: okStream([
        ev('meta', { grounded: true }),
        ev('delta', { text: 'Caspel ERP covers ' }),
        ev('delta', { text: 'CRM and procurement.' }),
        ev('citations', {
          sources: [{ document: 'CASPEL ERP Presentation', page: 4, slug: 'erp' }],
        }),
        ev('done', { complete: true }),
      ]),
    });

    wrap();
    await askQuestion();

    await waitFor(() =>
      expect(screen.getByText(/Caspel ERP covers CRM and procurement\./)).toBeInTheDocument()
    );

    // Exactly one assistant row, not one per delta.
    await waitFor(() => {
      expect(document.querySelectorAll('.chat__row--assistant')).toHaveLength(1);
    });
  });

  it('attaches server-validated citations to the finished answer', async () => {
    stubRoutes({
      stream: okStream([
        ev('delta', { text: 'Grounded answer.' }),
        ev('citations', {
          sources: [{ document: 'CASPEL Corporate Presentation', page: 7, slug: 'caspel' }],
        }),
        ev('done', { complete: true }),
      ]),
    });

    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByTestId('citation-link-0')).toBeInTheDocument());
    expect(screen.getByTestId('citation-link-0')).toHaveAttribute(
      'href',
      expect.stringContaining('page=7')
    );
  });

  it('records the question exactly once', async () => {
    stubRoutes({
      stream: okStream([ev('delta', { text: 'A.' }), ev('done', { complete: true })]),
    });
    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByText('A.')).toBeInTheDocument());
    const asked = trackAnalyticsEvent.mock.calls.filter((c) => c[0] === 'AI_QUESTION');
    expect(asked).toHaveLength(1);
  });

  it('shows the visitor message exactly once', async () => {
    stubRoutes({
      stream: okStream([ev('delta', { text: 'A.' }), ev('done', { complete: true })]),
    });
    wrap();
    await askQuestion('My question');

    await waitFor(() => expect(screen.getByText('A.')).toBeInTheDocument());
    expect(screen.getAllByText('My question')).toHaveLength(1);
  });

  it('survives a frame split mid-byte, keeping Chinese intact', async () => {
    stubRoutes({
      stream: okStream(
        [ev('delta', { text: '网络安全服务包括端点保护' }), ev('done', { complete: true })],
        true
      ),
    });
    wrap();
    await askQuestion();

    await waitFor(() =>
      expect(screen.getByText(/网络安全服务包括端点保护/)).toBeInTheDocument()
    );
  });

  it('never shows a raw SOURCE marker', async () => {
    stubRoutes({
      stream: okStream([
        ev('delta', { text: 'Answer with no marker.' }),
        ev('done', { complete: true }),
      ]),
    });
    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByText(/Answer with no marker\./)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/SOURCE_\d/);
  });
});

// ==========================================================================
// Fallback and failure
// ==========================================================================

describe('fallback and failure', () => {
  it('falls back silently when streaming is switched off', async () => {
    const mock = stubRoutes({
      stream: () => new Response('', { status: 404 }),
      plain: () =>
        new Response(
          JSON.stringify({ answer: 'Fallback answer.', sources: [], session_id: 's' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    });

    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByText('Fallback answer.')).toBeInTheDocument());
    // Both routes were tried, in order.
    const urls = mock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/chat/stream'))).toBe(true);
    expect(urls.some((u) => u.includes('/chat') && !u.includes('stream'))).toBe(true);
  });

  it('counts the question once even when it falls back', async () => {
    stubRoutes({ stream: () => new Response('', { status: 404 }) });
    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByText('Plain answer.')).toBeInTheDocument());
    expect(trackAnalyticsEvent.mock.calls.filter((c) => c[0] === 'AI_QUESTION')).toHaveLength(1);
  });

  it('does NOT fall back after a mid-stream error, and requires an explicit retry', async () => {
    const mock = stubRoutes({
      stream: okStream([
        ev('delta', { text: 'Half an answer' }),
        ev('error', { recoverable: false, reason: 'generation_failed' }),
      ]),
    });

    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByTestId('chat-failure')).toBeInTheDocument());
    // Generation already happened; a silent retry would run it twice. The
    // capability probe is not a generation and is excluded by name rather than
    // by a loose "/chat" match.
    const plainCalls = mock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => /\/chat(\?|$)/.test(u) || u.endsWith('/chat'));
    expect(plainCalls).toHaveLength(0);
  });

  it('does not store partial text as a finished answer', async () => {
    stubRoutes({
      stream: okStream([
        ev('delta', { text: 'Half an answer' }),
        ev('error', { recoverable: false, reason: 'generation_failed' }),
      ]),
    });

    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByTestId('chat-failure')).toBeInTheDocument());
    // No completed assistant row was committed.
    expect(document.querySelectorAll('.chat__message--assistant')).toHaveLength(0);
  });

  it('treats a stream that ends without done as interrupted', async () => {
    stubRoutes({ stream: okStream([ev('delta', { text: 'Truncated' })]) });
    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByTestId('chat-failure')).toBeInTheDocument());
  });

  it('falls back when the stream ends with no events at all', async () => {
    stubRoutes({ stream: okStream([]) });
    wrap();
    await askQuestion();

    // Nothing arrived, so nothing was generated that we saw: falling back is safe.
    await waitFor(() => expect(screen.getByText('Plain answer.')).toBeInTheDocument());
  });

  it('ignores a malformed frame without losing the answer', async () => {
    stubRoutes({
      stream: okStream([
        'event: delta\ndata: {not json}\n\n',
        ev('delta', { text: 'Good text.' }),
        ev('done', { complete: true }),
      ]),
    });
    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByText('Good text.')).toBeInTheDocument());
  });

  it('ignores a citations event that is not an array', async () => {
    stubRoutes({
      stream: okStream([
        ev('delta', { text: 'Answer.' }),
        ev('citations', { sources: 'not-an-array' }),
        ev('done', { complete: true }),
      ]),
    });
    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByText('Answer.')).toBeInTheDocument());
    expect(screen.queryByTestId('citation-link-0')).toBeNull();
  });
});

// ==========================================================================
// Lifecycle
// ==========================================================================

describe('lifecycle', () => {
  it('aborts the request when the modal closes mid-stream', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        // Streaming has to be advertised for the client to attempt it.
        if (String(input).includes('/chat/capabilities')) {
          return new Response(JSON.stringify({ streaming: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (String(input).includes('/chat/stream')) {
          signal = init?.signal ?? undefined;
          // Never completes: the abort is what ends it.
          return new Response(
            new ReadableStream({ start() { /* held open */ } }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      })
    );

    const { unmount } = wrap();
    await askQuestion();
    await waitFor(() => expect(signal).toBeDefined());

    unmount();
    expect(signal!.aborted).toBe(true);
  });

  it('produces no state update after unmount', async () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(String(args[0]));
      originalError(...(args as []));
    };

    stubRoutes({
      stream: okStream([ev('delta', { text: 'A.' }), ev('done', { complete: true })]),
    });
    const { unmount } = wrap();
    await askQuestion();
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    console.error = originalError;
    expect(errors.filter((e) => /unmounted/i.test(e))).toHaveLength(0);
  });
});

// ==========================================================================
// Capability contract
//
// The client asks the server which delivery paths exist instead of discovering
// it by attempting the streaming route and reading a 404. Streaming is off by
// default, so that discovery cost a failed request in front of every visitor
// question on a default deployment.
// ==========================================================================

describe('capability contract', () => {
  it('makes no streaming request at all when the server says streaming is off', async () => {
    const mock = stubRoutes({ capabilities: () => okJson({ streaming: false }) });

    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByText('Plain answer.')).toBeInTheDocument());

    const urls = mock.mock.calls.map((c) => String(c[0]));
    // The whole point: no wasted round trip.
    expect(urls.filter((u) => u.includes('/chat/stream'))).toHaveLength(0);
    expect(urls.some((u) => u.includes('/chat/capabilities'))).toBe(true);
  });

  it('streams when the server says streaming is on', async () => {
    stubRoutes({
      capabilities: () => okJson({ streaming: true }),
      stream: okStream([
        ev('delta', { text: 'Streamed because the server said so.' }),
        ev('done', { complete: true }),
      ]),
    });

    wrap();
    await askQuestion();

    await waitFor(() =>
      expect(screen.getByText(/Streamed because the server said so\./)).toBeInTheDocument()
    );
  });

  it('asks for capabilities once per load, not once per question', async () => {
    const mock = stubRoutes({ capabilities: () => okJson({ streaming: false }) });

    wrap();
    await askQuestion('First question');
    await waitFor(() => expect(screen.getAllByText('Plain answer.').length).toBe(1));
    await askQuestion('Second question');
    await waitFor(() => expect(screen.getAllByText('Plain answer.').length).toBe(2));

    const probes = mock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('/chat/capabilities'));
    // Server configuration, not per-visitor state.
    expect(probes).toHaveLength(1);
  });

  it('falls back to the plain endpoint when the capability probe fails', async () => {
    // An older backend has no such route. Degrading to the endpoint that has
    // always worked is the safe direction.
    stubRoutes({ capabilities: () => new Response('', { status: 404 }) });

    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByText('Plain answer.')).toBeInTheDocument());
  });

  it('treats a malformed capability payload as no streaming', async () => {
    stubRoutes({ capabilities: () => okJson({ streaming: 'yes please' }) });

    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByText('Plain answer.')).toBeInTheDocument());
  });

  it('still counts the question exactly once on the capability path', async () => {
    stubRoutes({ capabilities: () => okJson({ streaming: false }) });

    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByText('Plain answer.')).toBeInTheDocument());
    expect(trackAnalyticsEvent.mock.calls.filter((c) => c[0] === 'AI_QUESTION')).toHaveLength(1);
  });

  it('keeps the 404 safety net when the flag changes under a rolling deploy', async () => {
    // The server advertised streaming, then the route stopped answering. The
    // capability hint is not a guarantee, so the fallback must still be there.
    const mock = stubRoutes({
      capabilities: () => okJson({ streaming: true }),
      stream: () => new Response('', { status: 404 }),
    });

    wrap();
    await askQuestion();

    await waitFor(() => expect(screen.getByText('Plain answer.')).toBeInTheDocument());
    const urls = mock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/chat/stream'))).toBe(true);
    expect(trackAnalyticsEvent.mock.calls.filter((c) => c[0] === 'AI_QUESTION')).toHaveLength(1);
  });
});
