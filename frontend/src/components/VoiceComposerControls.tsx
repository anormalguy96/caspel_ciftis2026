import React from 'react';
import { Mic, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useVoiceRecorder, MAX_RECORDING_MS } from '../hooks/useVoiceRecorder';

/**
 * Microphone control for the chat composer.
 *
 * Renders nothing at all when the browser cannot record -- no microphone API,
 * or an insecure context. A dead button that explains itself only after being
 * pressed is worse than no button, and the text composer beside it is a
 * complete way to ask a question on its own.
 */

interface VoiceComposerControlsProps {
  disabled?: boolean;
  onTranscript: (text: string) => void;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(1, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export const VoiceComposerControls: React.FC<VoiceComposerControlsProps> = ({
  disabled,
  onTranscript,
}) => {
  const { t } = useTranslation();
  const { state, elapsedMs, amplitude, start, stop, cancel, dismissError } = useVoiceRecorder({
    onTranscript,
  });

  if (state === 'unsupported') return null;

  const recording = state === 'recording';
  const busy = state === 'requesting' || state === 'uploading';

  if (recording) {
    return (
      <div className="chat__voice chat__voice--recording" data-testid="voice-recording">
        <button
          type="button"
          className="chat__voice-btn chat__voice-btn--cancel"
          onClick={cancel}
          aria-label={t('ai.voiceCancel')}
          title={t('ai.voiceCancel')}
          data-testid="voice-cancel"
        >
          <X size={16} aria-hidden="true" />
        </button>

        <span className="chat__voice-meter" aria-hidden="true">
          {/* One element scaled on the compositor, driven by real microphone
              amplitude. Under reduced motion the hook stops sampling and this
              simply holds still. */}
          <span
            className="chat__voice-level"
            style={{ ['--level' as string]: Math.min(1, amplitude * 1.6).toFixed(3) }}
          />
        </span>

        <span className="chat__voice-time" data-testid="voice-timer">
          {formatElapsed(elapsedMs)} / {formatElapsed(MAX_RECORDING_MS)}
        </span>

        <button
          type="button"
          className="chat__voice-btn chat__voice-btn--stop"
          onClick={stop}
          aria-label={t('ai.voiceStop')}
          title={t('ai.voiceStop')}
          data-testid="voice-stop"
        >
          <Square size={15} aria-hidden="true" />
        </button>

        <span className="visually-hidden" role="status" aria-live="polite">
          {t('ai.voiceRecording')}
        </span>
      </div>
    );
  }

  return (
    <div className="chat__voice">
      <button
        type="button"
        className="chat__voice-btn"
        onClick={state === 'denied' || state === 'failed' ? dismissError : start}
        disabled={disabled || busy}
        aria-label={t('ai.voiceStart')}
        title={t('ai.voiceStart')}
        data-state={state}
        data-testid="voice-start"
      >
        <Mic size={18} aria-hidden="true" />
      </button>

      <span className="chat__voice-status" role="status" aria-live="polite">
        {state === 'uploading' && t('ai.voiceTranscribing')}
        {state === 'denied' && t('ai.voiceDenied')}
        {state === 'failed' && t('ai.voiceFailed')}
      </span>
    </div>
  );
};
