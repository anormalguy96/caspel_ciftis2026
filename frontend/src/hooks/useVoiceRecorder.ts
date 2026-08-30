import { useCallback, useEffect, useRef, useState } from 'react';

import { apiUrl } from '../config/paths';

/**
 * Record a short spoken question, upload it, and hand back the transcript.
 *
 * The transcript is deliberately NOT sent as a question. It lands in the
 * composer and the visitor edits and sends it themselves, because a mis-heard
 * product name would otherwise become a question the corpus cannot answer,
 * asked on their behalf, without their ever seeing it.
 *
 * Everything is torn down on stop, cancel, unmount and navigation: the
 * recorder, every media track, the object URLs, the timer and the animation
 * frame. A live microphone track left running is both a battery cost and a
 * recording indicator the visitor did not ask for.
 */

export type RecorderState =
  | 'unsupported'
  | 'idle'
  | 'requesting'
  | 'denied'
  | 'recording'
  | 'uploading'
  | 'failed';

/** Hard cap. The browser stops itself; the server refuses anything longer. */
export const MAX_RECORDING_MS = 60_000;

/**
 * Container formats in the order we would rather have them.
 *
 * Opus in WebM is small and widely supported; MP4/AAC is what Safari gives.
 * The list is probed with MediaRecorder.isTypeSupported rather than assumed,
 * because guessing wrong throws at construction time.
 */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/aac',
];

export function pickMimeType(
  isSupported: (t: string) => boolean = (t) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
): string | null {
  for (const type of PREFERRED_MIME_TYPES) {
    try {
      if (isSupported(type)) return type;
    } catch {
      /* Some engines throw on unknown types rather than returning false. */
    }
  }
  return null;
}

export function microphoneSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

interface UseVoiceRecorderOptions {
  /** Called with the transcript. The caller decides what to do with it. */
  onTranscript: (text: string) => void;
}

export function useVoiceRecorder({ onTranscript }: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecorderState>(() =>
    microphoneSupported() ? 'idle' : 'unsupported'
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [amplitude, setAmplitude] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const timerRef = useRef<number | undefined>(undefined);
  const stopTimeoutRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  /** Release every resource. Safe to call more than once. */
  const teardown = useCallback(() => {
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    frameRef.current = undefined;

    if (timerRef.current !== undefined) window.clearInterval(timerRef.current);
    timerRef.current = undefined;

    if (stopTimeoutRef.current !== undefined) window.clearTimeout(stopTimeoutRef.current);
    stopTimeoutRef.current = undefined;

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* Already stopping. */
      }
    }
    recorderRef.current = null;

    // Every track, not just the first: a device can expose several, and any
    // one left live keeps the browser's recording indicator on.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});

    chunksRef.current = [];
    setAmplitude(0);
  }, []);

  useEffect(() => () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    teardown();
  }, [teardown]);

  const upload = useCallback(
    async (blob: Blob, mimeType: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setState('uploading');

      try {
        const form = new FormData();
        form.append('audio', blob, `voice.${mimeType.includes('mp4') ? 'm4a' : 'webm'}`);

        const response = await fetch(apiUrl('/api/chat/transcribe'), {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });

        if (!response.ok) throw new Error(`transcribe ${response.status}`);

        const data = (await response.json()) as { text?: string };
        const text = (data.text || '').trim();
        if (!text) throw new Error('empty transcript');

        if (!cancelledRef.current) {
          onTranscript(text);
          setState('idle');
        }
      } catch (error) {
        if (cancelledRef.current || (error as Error).name === 'AbortError') return;
        setState('failed');
      } finally {
        abortRef.current = null;
      }
    },
    [onTranscript]
  );

  const start = useCallback(async () => {
    if (!microphoneSupported()) {
      setState('unsupported');
      return;
    }
    // One recording at a time. A second tap while recording must not open a
    // second stream.
    if (state === 'recording' || state === 'requesting' || state === 'uploading') return;

    const mimeType = pickMimeType();
    if (!mimeType) {
      setState('unsupported');
      return;
    }

    cancelledRef.current = false;
    setState('requesting');
    setElapsedMs(0);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, dismissed, or no device. All are the same to the visitor: the
      // text composer is still there and still works.
      setState('denied');
      return;
    }

    if (cancelledRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      teardown();
      setState('unsupported');
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      teardown();

      if (cancelledRef.current || chunks.length === 0) {
        if (!cancelledRef.current) setState('idle');
        return;
      }
      void upload(new Blob(chunks, { type: mimeType }), mimeType);
    };

    // A real amplitude reading, not a decorative animation: it only moves
    // because the microphone is picking something up, which is how a visitor
    // can tell recording is actually working.
    try {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioCtor();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!reduced) {
        const tick = () => {
          analyser.getByteTimeDomainData(buffer);
          let peak = 0;
          for (let i = 0; i < buffer.length; i += 1) {
            peak = Math.max(peak, Math.abs(buffer[i] - 128) / 128);
          }
          setAmplitude(peak);
          frameRef.current = requestAnimationFrame(tick);
        };
        frameRef.current = requestAnimationFrame(tick);
      }
    } catch {
      /* No meter. Recording still works, which is the part that matters. */
    }

    recorder.start();
    setState('recording');

    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 200);

    // The browser stops itself at the cap, so a forgotten recording cannot run
    // until the tab closes.
    stopTimeoutRef.current = window.setTimeout(() => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    }, MAX_RECORDING_MS);
  }, [state, teardown, upload]);

  /** Finish and transcribe. */
  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    } else {
      teardown();
      setState('idle');
    }
  }, [teardown]);

  /** Abandon: nothing is uploaded and nothing is kept. */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    teardown();
    setState('idle');
    setElapsedMs(0);
  }, [teardown]);

  const dismissError = useCallback(() => setState('idle'), []);

  return {
    state,
    elapsedMs,
    amplitude,
    remainingMs: Math.max(0, MAX_RECORDING_MS - elapsedMs),
    start,
    stop,
    cancel,
    dismissError,
  };
}
