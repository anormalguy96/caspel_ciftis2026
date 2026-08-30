import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Check, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { downloadPresentation } from '../services/presentations';
import type { ProductSlug } from '../types';

/**
 * The download action for a presentation.
 *
 * A first-class control rather than a small secondary button: at the stand
 * this is the thing a visitor actually wants to walk away with.
 *
 * The states are real. There is no artificial delay: `starting` covers the
 * moment the anchor is created and clicked, and `started` is a short
 * confirmation that the browser took over. The transfer itself belongs to the
 * browser after that point, so the control does not pretend to track progress
 * it cannot see.
 *
 * The download goes through the same verified endpoint as before, with the
 * same filename, and the original bytes are untouched -- the anchor streams
 * from the server rather than being buffered through JavaScript, which is
 * also why a 24 MiB deck does not sit in memory.
 */

interface DownloadPresentationButtonProps {
  slug: ProductSlug;
  filename: string;
  onDownloaded?: () => void;
  className?: string;
}

type DownloadState = 'idle' | 'starting' | 'started' | 'failed';

/** How long the confirmation holds before returning to rest. */
const FEEDBACK_MS = 2400;

export const DownloadPresentationButton: React.FC<DownloadPresentationButtonProps> = ({
  slug,
  filename,
  onDownloaded,
  className,
}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<DownloadState>('idle');
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  const handleClick = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setState('starting');

    try {
      downloadPresentation(slug, filename);
      setState('started');
      onDownloaded?.();
    } catch {
      // The anchor could not be created or dispatched. The visitor is told,
      // rather than left looking at a control that appeared to do nothing.
      setState('failed');
    }

    timerRef.current = window.setTimeout(() => setState('idle'), FEEDBACK_MS);
  }, [slug, filename, onDownloaded]);

  const label =
    state === 'started'
      ? t('actions.downloadStarted', { defaultValue: 'Download started' })
      : state === 'failed'
        ? t('actions.downloadFailed', { defaultValue: 'Download failed' })
        : t('actions.download');

  return (
    <>
      <button
        type="button"
        className={`btn btn--primary viewer-bar__download${className ? ` ${className}` : ''}`}
        onClick={handleClick}
        data-state={state}
        aria-label={label}
        data-testid="download-presentation"
      >
        {/* All three icons occupy one grid cell so the confirmation swap cannot
            resize the control while a finger is on it. */}
        <span className="viewer-bar__download-icon" aria-hidden="true">
          <Download size={18} className="viewer-bar__download-glyph viewer-bar__download-glyph--rest" />
          <Check size={18} className="viewer-bar__download-glyph viewer-bar__download-glyph--done" />
          <AlertTriangle size={18} className="viewer-bar__download-glyph viewer-bar__download-glyph--fail" />
        </span>
        <span className="viewer-bar__download-label">{label}</span>
      </button>

      <span className="visually-hidden" role="status" aria-live="polite">
        {state === 'started' && t('actions.downloadStarted', { defaultValue: 'Download started' })}
        {state === 'failed' && t('actions.downloadFailed', { defaultValue: 'Download failed' })}
      </span>
    </>
  );
};
