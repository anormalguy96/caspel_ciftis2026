import { describe, it, expect, vi, afterEach } from 'vitest';

import { parseSseBuffer, streamChat, StreamUnavailableError } from '../services/chatStream';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ==========================================================================
// SSE framing
// ==========================================================================

describe('SSE frame parsing', () => {
  it('reads a complete frame', () => {
    const { events, rest } = parseSseBuffer('event: delta\ndata: {"text":"hi"}\n\n');
    expect(events).toEqual([{ event: 'delta', data: { text: 'hi' } }]);
    expect(rest).toBe('');
  });

  it('carries an incomplete frame forward instead of dropping it', () => {
    // A frame can straddle any number of network chunks.
    const { events, rest } = parseSseBuffer('event: delta\ndata: {"text":"hi"}\n\nevent: do');
    expect(events).toHaveLength(1);
    expect(rest).toBe('event: do');
  });

  it('reassembles a frame split across two buffers', () => {
    const first = parseSseBuffer('event: delta\ndata: {"te');
    expect(first.events).toHaveLength(0);
    const second = parseSseBuffer(first.rest + 'xt":"hi"}\n\n');
    expect(second.events[0].data).toEqual({ text: 'hi' });
  });

  it('reads several frames from one buffer', () => {
    const { events } = parseSseBuffer(
      'event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text":"b"}\n\n'
    );
    expect(events.map((e) => (e.data as { text: string }).text)).toEqual(['a', 'b']);
  });

  it('drops heartbeat comments', () => {
    const { events } = parseSseBuffer(': keep-alive\n\nevent: delta\ndata: {"text":"a"}\n\n');
    expect(events).toHaveLength(1);
  });

  it('survives a malformed frame without losing the stream', () => {
    const { events } = parseSseBuffer(
      'event: delta\ndata: {not json}\n\nevent: delta\ndata: {"text":"ok"}\n\n'
    );
    expect(events).toHaveLength(1);
    expect((events[0].data as { text: string }).text).toBe('ok');
  });

  it('keeps Chinese text intact through framing', () => {
    const { events } = parseSseBuffer(
      `event: delta\ndata: ${JSON.stringify({ text: '网络安全服务' })}\n\n`
    );
    expect((events[0].data as { text: string }).text).toBe('网络安全服务');
  });

  it('keeps an embedded newline inside the payload', () => {
    const { events } = parseSseBuffer(
      `event: delta\ndata: ${JSON.stringify({ text: 'line one\nline two' })}\n\n`
    );
    expect((events[0].data as { text: string }).text).toBe('line one\nline two');
  });
});

// ==========================================================================
// Consuming a stream
// ==========================================================================

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
}

function stubFetch(status: number, chunks: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      status === 200
        ? new Response(bodyOf(chunks), { status })
        : new Response('nope', { status })
    )
  );
}

describe('streamChat', () => {
  it('delivers deltas in order and then citations and done', async () => {
    stubFetch(200, [
      'event: meta\ndata: {"grounded":true}\n\n',
      'event: delta\ndata: {"text":"Hello "}\n\n',
      'event: delta\ndata: {"text":"world."}\n\n',
      'event: citations\ndata: {"sources":[{"document":"D","page":7,"slug":"caspel"}]}\n\n',
      'event: done\ndata: {"complete":true}\n\n',
    ]);

    const deltas: string[] = [];
    let sources: unknown[] = [];
    let done = false;
    let grounded: boolean | null = null;

    await streamChat({ session_id: 's', message: 'q' }, {
      onMeta: (m) => { grounded = m.grounded; },
      onDelta: (t) => deltas.push(t),
      onCitations: (s) => { sources = s; },
      onDone: () => { done = true; },
    });

    expect(grounded).toBe(true);
    expect(deltas.join('')).toBe('Hello world.');
    expect(sources).toHaveLength(1);
    expect(done).toBe(true);
  });

  it('reassembles a multi-byte character split across network chunks', async () => {
    // The frame is fine; the *bytes* are split mid-character. Decoding each
    // chunk independently would produce a replacement character.
    const encoder = new TextEncoder();
    const frame = encoder.encode('event: delta\ndata: {"text":"网络"}\n\n');
    const cut = 20;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(frame.slice(0, cut));
              c.enqueue(frame.slice(cut));
              c.close();
            },
          }),
          { status: 200 }
        )
      )
    );

    const deltas: string[] = [];
    await streamChat({ session_id: 's', message: 'q' }, { onDelta: (t) => deltas.push(t) });
    expect(deltas.join('')).toBe('网络');
  });

  it('treats 404 as "streaming is switched off", not as an error to show', async () => {
    stubFetch(404, []);
    await expect(
      streamChat({ session_id: 's', message: 'q' }, { onDelta: () => {} })
    ).rejects.toBeInstanceOf(StreamUnavailableError);
  });

  it('treats any non-OK status as unavailable so the caller can fall back', async () => {
    stubFetch(503, []);
    await expect(
      streamChat({ session_id: 's', message: 'q' }, { onDelta: () => {} })
    ).rejects.toBeInstanceOf(StreamUnavailableError);
  });

  it('reports a mid-stream error and never signals completion', async () => {
    stubFetch(200, [
      'event: delta\ndata: {"text":"Half an "}\n\n',
      'event: error\ndata: {"recoverable":false,"reason":"generation_failed"}\n\n',
    ]);

    const deltas: string[] = [];
    let done = false;
    let error: { recoverable: boolean; reason: string } | undefined;

    await streamChat({ session_id: 's', message: 'q' }, {
      onDelta: (t) => deltas.push(t),
      onDone: () => { done = true; },
      onError: (e) => { error = e; },
    });

    expect(deltas.join('')).toBe('Half an ');
    expect(error?.recoverable).toBe(false);
    // A partial answer must never look finished.
    expect(done).toBe(false);
  });

  it('marks a pre-text failure as recoverable so a fallback is safe', async () => {
    stubFetch(200, [
      'event: error\ndata: {"recoverable":true,"reason":"generation_failed"}\n\n',
    ]);
    let error: { recoverable: boolean; reason: string } | undefined;
    await streamChat({ session_id: 's', message: 'q' }, {
      onDelta: () => {},
      onError: (e) => { error = e; },
    });
    expect(error?.recoverable).toBe(true);
  });

  it('passes an abort signal through to fetch', async () => {
    const controller = new AbortController();
    stubFetch(200, ['event: done\ndata: {"complete":true}\n\n']);
    await streamChat({ session_id: 's', message: 'q' }, { onDelta: () => {} }, controller.signal);
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.signal).toBe(controller.signal);
  });

  it('posts to the streaming route with a JSON body', async () => {
    stubFetch(200, ['event: done\ndata: {"complete":true}\n\n']);
    await streamChat({ session_id: 's', message: 'q', ui_locale: 'zh-CN' }, { onDelta: () => {} });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('chat/stream');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).ui_locale).toBe('zh-CN');
  });

  it('never surfaces a raw SOURCE marker from a delta', async () => {
    // The server strips these, but the client must not reintroduce them by
    // concatenating anything of its own.
    stubFetch(200, [
      'event: delta\ndata: {"text":"Grounded answer."}\n\n',
      'event: done\ndata: {"complete":true}\n\n',
    ]);
    const deltas: string[] = [];
    await streamChat({ session_id: 's', message: 'q' }, { onDelta: (t) => deltas.push(t) });
    expect(deltas.join('')).not.toMatch(/SOURCE_\d/);
  });
});
