import { apiUrl } from '../config/paths';
import type { ChatSource } from '../types';

/**
 * Consume the assistant's server-sent stream.
 *
 * `fetch` rather than `EventSource`, because the question is a POST body and
 * `EventSource` can only issue GETs. The trade-off is that SSE framing has to
 * be parsed here, which is the small function below.
 *
 * The stream is additive. When it is unavailable -- the deployment has it
 * switched off and returns 404, or the connection fails before any text -- the
 * caller falls back to the ordinary endpoint and the visitor sees no
 * difference beyond the answer arriving all at once.
 */

export type StreamEventName = 'meta' | 'delta' | 'citations' | 'done' | 'error';

export interface StreamHandlers {
  onMeta?: (data: { grounded: boolean }) => void;
  onDelta: (text: string) => void;
  onCitations?: (sources: ChatSource[]) => void;
  onDone?: () => void;
  /** `recoverable` is true only when nothing was shown, so a retry is safe. */
  onError?: (info: { recoverable: boolean; reason: string }) => void;
}

export class StreamUnavailableError extends Error {}

/**
 * Split an SSE byte stream into events.
 *
 * Frames are separated by a blank line, so a frame can straddle any number of
 * network chunks. Everything before the last separator is complete; the
 * remainder is carried forward. Comment lines beginning with ":" are
 * heartbeats and are dropped.
 */
export function parseSseBuffer(
  buffer: string
): { events: Array<{ event: string; data: unknown }>; rest: string } {
  const events: Array<{ event: string; data: unknown }> = [];
  const parts = buffer.split('\n\n');
  // The final part has not been terminated yet and may still be growing.
  const rest = parts.pop() ?? '';

  for (const frame of parts) {
    let name = 'message';
    const dataLines: string[] = [];

    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }

    if (!dataLines.length) continue;
    try {
      events.push({ event: name, data: JSON.parse(dataLines.join('\n')) });
    } catch {
      // A frame we cannot parse is dropped rather than crashing the stream.
      // The `done` event is what marks completion, so a lost frame degrades
      // the answer instead of silently truncating it without notice.
    }
  }

  return { events, rest };
}

export async function streamChat(
  body: { session_id: string; message: string; ui_locale?: string },
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(apiUrl('chat/stream'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  // 404 is how a deployment says streaming is switched off. It is not an
  // error to report to the visitor; the caller retries the ordinary endpoint.
  if (response.status === 404) throw new StreamUnavailableError('streaming disabled');
  if (!response.ok || !response.body) {
    throw new StreamUnavailableError(`stream unavailable (${response.status})`);
  }

  const reader = response.body.getReader();
  // Streaming decode: a multi-byte character can be split across chunks, and
  // decoding each chunk independently would corrupt Chinese text.
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseBuffer(buffer);
      buffer = rest;

      for (const { event, data } of events) {
        switch (event as StreamEventName) {
          case 'meta':
            handlers.onMeta?.(data as { grounded: boolean });
            break;
          case 'delta':
            handlers.onDelta((data as { text: string }).text);
            break;
          case 'citations':
            handlers.onCitations?.((data as { sources: ChatSource[] }).sources ?? []);
            break;
          case 'done':
            handlers.onDone?.();
            break;
          case 'error':
            handlers.onError?.(data as { recoverable: boolean; reason: string });
            break;
          default:
            break;
        }
      }
    }
  } finally {
    // Releasing the lock lets an aborted stream tear its connection down
    // rather than leaving it pinned until garbage collection.
    try {
      reader.releaseLock();
    } catch {
      /* Already released by the abort. */
    }
  }
}

/** What this deployment's chat surface actually offers. */
export interface ChatCapabilities {
  streaming: boolean;
}

/**
 * Cached for the page's lifetime.
 *
 * The flag is server configuration, not per-visitor state, so asking more than
 * once per load is pure waste. The in-flight promise is cached too, so a
 * visitor who opens the modal and immediately sends a question makes one
 * request rather than two.
 */
let capabilitiesPromise: Promise<ChatCapabilities> | null = null;

/**
 * Asks the server which delivery paths exist, before committing to one.
 *
 * Without this the client discovered streaming's availability by attempting it
 * and reading the 404 -- and since streaming is off by default, that put a
 * failed request in front of every visitor question on a default deployment.
 *
 * Any failure resolves to `streaming: false`. That is the safe direction: the
 * plain endpoint is the one that has always worked, so an unreachable or older
 * backend (one predating this route, which answers 404) degrades to exactly
 * the behaviour that shipped before streaming existed, rather than to an
 * error the visitor can see.
 */
export async function fetchChatCapabilities(signal?: AbortSignal): Promise<ChatCapabilities> {
  if (!capabilitiesPromise) {
    capabilitiesPromise = (async () => {
      try {
        const response = await fetch(apiUrl('chat/capabilities'), { signal });
        if (!response.ok) return { streaming: false };
        const body: unknown = await response.json();
        // Trust the shape, not the sender: anything but a real boolean is
        // treated as "no streaming" rather than coerced into one.
        const streaming =
          typeof body === 'object' && body !== null && 'streaming' in body
            ? (body as { streaming: unknown }).streaming === true
            : false;
        return { streaming };
      } catch {
        return { streaming: false };
      }
    })();
  }
  return capabilitiesPromise;
}

/** Test seam. Never called by the application. */
export function resetChatCapabilitiesCache(): void {
  capabilitiesPromise = null;
}
