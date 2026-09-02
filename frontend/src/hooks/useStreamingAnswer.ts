import { useCallback, useEffect, useRef, useState } from 'react';

import { streamChat, StreamUnavailableError } from '../services/chatStream';
import type { ChatSource } from '../types';

/**
 * Drives one streamed answer.
 *
 * Two rules shape the design, and both are about not lying to the visitor.
 *
 * **Fallback is only automatic when no generation can have happened.** A 404 or
 * a non-OK status means the route never ran, so retrying on the plain endpoint
 * costs nothing and duplicates nothing. An `error` *event*, by contrast, means
 * the server did call the provider — falling back there would bill a second
 * generation and could record the question twice. That case surfaces an
 * interrupted state and waits for the visitor to ask again.
 *
 * **Partial text is never a finished answer.** The stream is committed to the
 * transcript only after `done`. An interrupted stream keeps its text on screen
 * so the visitor is not robbed of what they were reading, but it is marked
 * incomplete and never stored as an assistant reply.
 *
 * The accumulated answer lives in a ref and state mirrors it, not the other way
 * round. Reading it back out of state would give a callback whatever React had
 * last committed, which during a fast stream is not what has actually arrived.
 */

export type StreamPhase =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'complete'
  | 'interrupted';

export interface StreamTimings {
  /** request start → first delta painted. */
  firstTextMs: number | null;
  /** request start → done. */
  completeMs: number | null;
  /** How many times the answer was re-rendered. */
  renderCount: number;
}

/**
 * Deltas are flushed on a timer rather than per token.
 *
 * Re-parsing Markdown on every token is the expensive part, and a provider can
 * emit many small chunks per second. 70ms is below the point where text stops
 * reading as live, while cutting render work by roughly an order of magnitude
 * on a fast stream. The first delta bypasses the timer entirely, so batching
 * never costs time-to-first-text.
 */
export const FLUSH_INTERVAL_MS = 70;

interface UseStreamingAnswerOptions {
  onComplete: (text: string, sources: ChatSource[]) => void;
  /** The endpoint was absent; the caller may safely use /api/chat. */
  onUnavailable: (question: string) => void;
  /** Generation was attempted and failed; an explicit retry is required. */
  onInterrupted: (question: string, partialText: string) => void;
}

export function useStreamingAnswer({
  onComplete,
  onUnavailable,
  onInterrupted,
}: UseStreamingAnswerOptions) {
  const [phase, setPhase] = useState<StreamPhase>('idle');
  const [text, setText] = useState('');
  const [timings, setTimings] = useState<StreamTimings>({
    firstTextMs: null,
    completeMs: null,
    renderCount: 0,
  });

  const controllerRef = useRef<AbortController | null>(null);
  const answerRef = useRef('');
  const pendingRef = useRef('');
  const flushTimerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const startedAtRef = useRef(0);
  const sawTextRef = useRef(false);
  const sawDoneRef = useRef(false);
  const renderCountRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Unmount aborts the request and cancels any pending flush, so no state
      // update can land on a component that no longer exists.
      mountedRef.current = false;
      controllerRef.current?.abort();
      if (flushTimerRef.current !== undefined) window.clearTimeout(flushTimerRef.current);
    };
  }, []);

  const flush = useCallback(() => {
    if (flushTimerRef.current !== undefined) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = undefined;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = '';
    answerRef.current += pending;
    renderCountRef.current += 1;
    if (mountedRef.current) setText(answerRef.current);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== undefined) return;
    flushTimerRef.current = window.setTimeout(flush, FLUSH_INTERVAL_MS);
  }, [flush]);

  const reset = useCallback(() => {
    if (flushTimerRef.current !== undefined) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = undefined;
    }
    pendingRef.current = '';
    answerRef.current = '';
    sawTextRef.current = false;
    sawDoneRef.current = false;
    renderCountRef.current = 0;
  }, []);

  /** Visitor abandoned the answer. Nothing is kept and nothing is recorded. */
  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    reset();
    if (mountedRef.current) {
      setPhase('idle');
      setText('');
    }
  }, [reset]);

  const start = useCallback(
    async (question: string, sessionId: string, locale: string) => {
      // One stream at a time; a second submit would interleave two answers.
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      reset();
      startedAtRef.current = performance.now();
      setText('');
      setPhase('connecting');
      setTimings({ firstTextMs: null, completeMs: null, renderCount: 0 });

      let sources: ChatSource[] = [];

      try {
        await streamChat(
          { session_id: sessionId, message: question, ui_locale: locale },
          {
            onDelta: (chunk) => {
              if (!mountedRef.current) return;
              pendingRef.current += chunk;
              if (!sawTextRef.current) {
                sawTextRef.current = true;
                setTimings((t) => ({
                  ...t,
                  firstTextMs: performance.now() - startedAtRef.current,
                }));
                setPhase('streaming');
                flush();
              } else {
                scheduleFlush();
              }
            },
            onCitations: (incoming) => {
              // Server-validated. The client never constructs a source itself.
              sources = Array.isArray(incoming) ? incoming : [];
            },
            onDone: () => {
              if (!mountedRef.current) return;
              sawDoneRef.current = true;
              flush();
              setTimings((t) => ({
                ...t,
                completeMs: performance.now() - startedAtRef.current,
                renderCount: renderCountRef.current,
              }));
              setPhase('complete');
              onComplete(answerRef.current, sources);
            },
            onError: () => {
              if (!mountedRef.current) return;
              sawDoneRef.current = true;
              flush();
              // The provider was called. A fallback here would generate twice.
              setPhase('interrupted');
              onInterrupted(question, answerRef.current);
            },
          },
          controller.signal
        );

        // The body ended without a terminal event. The server closed the
        // connection mid-answer, or the route returned something that is not
        // this protocol at all. Either way it is not a completed answer, and
        // silently doing nothing would leave the visitor watching a spinner.
        if (!sawDoneRef.current && mountedRef.current) {
          if (sawTextRef.current) {
            setPhase('interrupted');
            onInterrupted(question, answerRef.current);
          } else {
            // Nothing arrived, so nothing was generated that we saw. Safe to
            // fall back to the plain endpoint.
            setPhase('idle');
            onUnavailable(question);
          }
        }
      } catch (error) {
        if (!mountedRef.current) return;
        if ((error as Error).name === 'AbortError') return;

        if (error instanceof StreamUnavailableError) {
          // The route never ran: nothing generated, nothing recorded.
          setPhase('idle');
          onUnavailable(question);
          return;
        }

        // The transport failed. Safe to fall back only if nothing was shown,
        // because text on screen means the provider had already started.
        if (sawTextRef.current) {
          setPhase('interrupted');
          onInterrupted(question, answerRef.current);
        } else {
          setPhase('idle');
          onUnavailable(question);
        }
      }
    },
    [flush, scheduleFlush, reset, onComplete, onUnavailable, onInterrupted]
  );

  return { phase, text, timings, start, cancel };
}
