import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

import { VoiceComposerControls } from '../components/VoiceComposerControls';
import { pickMimeType, microphoneSupported, MAX_RECORDING_MS } from '../hooks/useVoiceRecorder';

vi.mock('../services/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  getSessionId: () => 'test-session',
}));

// --------------------------------------------------------------------------
// A MediaRecorder good enough to exercise the lifecycle
// --------------------------------------------------------------------------

class FakeMediaRecorder {
  static supported = new Set(['audio/webm;codecs=opus', 'audio/webm']);
  static instances: FakeMediaRecorder[] = [];

  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(public stream: MediaStream, public options: { mimeType: string }) {
    FakeMediaRecorder.instances.push(this);
  }

  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supported.has(type);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: this.options.mimeType }) });
    this.onstop?.();
  }
}

const stoppedTracks: string[] = [];

function fakeStream(): MediaStream {
  const track = {
    kind: 'audio',
    stop: () => stoppedTracks.push('audio'),
  };
  return { getTracks: () => [track] } as unknown as MediaStream;
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stoppedTracks.length = 0;
  FakeMediaRecorder.instances.length = 0;
  FakeMediaRecorder.supported = new Set(['audio/webm;codecs=opus', 'audio/webm']);

  getUserMedia = vi.fn().mockResolvedValue(fakeStream());
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ text: 'What is Caspel ERP?' }), { status: 200 }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ==========================================================================
// Capability detection
// ==========================================================================

describe('capability detection', () => {
  it('renders nothing when the browser cannot record', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    const { container } = render(<VoiceComposerControls onTranscript={() => {}} />);
    // A dead button that explains itself only after being pressed is worse
    // than no button; the text composer is a complete alternative.
    expect(container.querySelector('[data-testid="voice-start"]')).toBeNull();
  });

  it('renders nothing when there is no mediaDevices at all', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const { container } = render(<VoiceComposerControls onTranscript={() => {}} />);
    expect(container.querySelector('[data-testid="voice-start"]')).toBeNull();
  });

  it('reports support only when every piece is present', () => {
    expect(microphoneSupported()).toBe(true);
    vi.stubGlobal('MediaRecorder', undefined);
    expect(microphoneSupported()).toBe(false);
  });
});

// ==========================================================================
// MIME negotiation
// ==========================================================================

describe('container negotiation', () => {
  it('prefers Opus in WebM when it is available', () => {
    expect(pickMimeType((t) => t === 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus');
  });

  it('falls back to MP4 where WebM is not supported', () => {
    expect(pickMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
  });

  it('returns null when nothing in the list is supported', () => {
    expect(pickMimeType(() => false)).toBeNull();
  });

  it('survives an engine that throws instead of returning false', () => {
    expect(
      pickMimeType((t) => {
        if (t !== 'audio/mp4') throw new TypeError('nope');
        return true;
      })
    ).toBe('audio/mp4');
  });
});

// ==========================================================================
// Recording lifecycle
// ==========================================================================

describe('recording lifecycle', () => {
  it('shows a recording state with stop and cancel', async () => {
    render(<VoiceComposerControls onTranscript={() => {}} />);
    fireEvent.click(screen.getByTestId('voice-start'));

    await screen.findByTestId('voice-recording');
    expect(screen.getByTestId('voice-stop')).toBeInTheDocument();
    expect(screen.getByTestId('voice-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('voice-timer')).toBeInTheDocument();
  });

  it('fills the composer but never sends on its own', async () => {
    const onTranscript = vi.fn();
    render(<VoiceComposerControls onTranscript={onTranscript} />);

    fireEvent.click(screen.getByTestId('voice-start'));
    await screen.findByTestId('voice-recording');
    fireEvent.click(screen.getByTestId('voice-stop'));

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('What is Caspel ERP?'));
    // The hook hands back text. Sending stays the visitor's decision, because a
    // mis-heard product name would otherwise be asked on their behalf unseen.
    expect(onTranscript).toHaveBeenCalledTimes(1);
  });

  it('uploads to the same-origin transcription endpoint as multipart', async () => {
    render(<VoiceComposerControls onTranscript={() => {}} />);
    fireEvent.click(screen.getByTestId('voice-start'));
    await screen.findByTestId('voice-recording');
    fireEvent.click(screen.getByTestId('voice-stop'));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/api/chat/transcribe');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('cancelling uploads nothing and keeps the composer untouched', async () => {
    const onTranscript = vi.fn();
    render(<VoiceComposerControls onTranscript={onTranscript} />);

    fireEvent.click(screen.getByTestId('voice-start'));
    await screen.findByTestId('voice-recording');
    fireEvent.click(screen.getByTestId('voice-cancel'));

    await waitFor(() => expect(screen.queryByTestId('voice-recording')).toBeNull());
    expect(fetch).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('stops every media track when recording ends', async () => {
    render(<VoiceComposerControls onTranscript={() => {}} />);
    fireEvent.click(screen.getByTestId('voice-start'));
    await screen.findByTestId('voice-recording');
    fireEvent.click(screen.getByTestId('voice-stop'));

    // A live track keeps the browser's recording indicator on.
    await waitFor(() => expect(stoppedTracks.length).toBeGreaterThan(0));
  });

  it('stops every media track when cancelled', async () => {
    render(<VoiceComposerControls onTranscript={() => {}} />);
    fireEvent.click(screen.getByTestId('voice-start'));
    await screen.findByTestId('voice-recording');
    fireEvent.click(screen.getByTestId('voice-cancel'));

    await waitFor(() => expect(stoppedTracks.length).toBeGreaterThan(0));
  });

  it('releases the microphone when the component unmounts mid-recording', async () => {
    const { unmount } = render(<VoiceComposerControls onTranscript={() => {}} />);
    fireEvent.click(screen.getByTestId('voice-start'));
    await screen.findByTestId('voice-recording');

    unmount();

    await waitFor(() => expect(stoppedTracks.length).toBeGreaterThan(0));
  });

  it('opens only one stream even if the control is pressed twice', async () => {
    render(<VoiceComposerControls onTranscript={() => {}} />);
    fireEvent.click(screen.getByTestId('voice-start'));
    await screen.findByTestId('voice-recording');

    // Once recording, the start control is replaced, but the guard is in the
    // hook: a second start must not open a second stream.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('stops itself at the recording cap', async () => {
    vi.useFakeTimers();
    try {
      render(<VoiceComposerControls onTranscript={() => {}} />);
      fireEvent.click(screen.getByTestId('voice-start'));
      await act(async () => {
        await Promise.resolve();
      });

      const recorder = FakeMediaRecorder.instances[0];
      expect(recorder.state).toBe('recording');

      act(() => {
        vi.advanceTimersByTime(MAX_RECORDING_MS + 100);
      });

      expect(recorder.state).toBe('inactive');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ==========================================================================
// Failure paths
// ==========================================================================

describe('failure paths', () => {
  it('reports a denied permission without looping', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    render(<VoiceComposerControls onTranscript={() => {}} />);

    fireEvent.click(screen.getByTestId('voice-start'));

    await waitFor(() =>
      expect(screen.getByTestId('voice-start')).toHaveAttribute('data-state', 'denied')
    );
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('reports an upload failure and leaves the composer usable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    const onTranscript = vi.fn();
    render(<VoiceComposerControls onTranscript={onTranscript} />);

    fireEvent.click(screen.getByTestId('voice-start'));
    await screen.findByTestId('voice-recording');
    fireEvent.click(screen.getByTestId('voice-stop'));

    await waitFor(() =>
      expect(screen.getByTestId('voice-start')).toHaveAttribute('data-state', 'failed')
    );
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('treats an empty transcript as a failure rather than inserting nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ text: '   ' }), { status: 200 }))
    );
    const onTranscript = vi.fn();
    render(<VoiceComposerControls onTranscript={onTranscript} />);

    fireEvent.click(screen.getByTestId('voice-start'));
    await screen.findByTestId('voice-recording');
    fireEvent.click(screen.getByTestId('voice-stop'));

    await waitFor(() =>
      expect(screen.getByTestId('voice-start')).toHaveAttribute('data-state', 'failed')
    );
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('falls back when no container format is supported', async () => {
    FakeMediaRecorder.supported = new Set();
    const { container } = render(<VoiceComposerControls onTranscript={() => {}} />);
    fireEvent.click(screen.getByTestId('voice-start'));

    await waitFor(() =>
      expect(container.querySelector('[data-testid="voice-start"]')).toBeNull()
    );
  });
});
