import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ChatSource } from '../types';
import { trackAnalyticsEvent } from '../services/analytics';

/**
 * Copies an assistant answer and its sources to the clipboard.
 *
 * What gets copied is deliberately narrow: the answer as the visitor read it,
 * plus a readable source list. Never the retrieval scores, the SOURCE_n
 * identifiers, the prompt, the session id or anything else the server used to
 * produce it -- someone pasting an answer into an email should not be pasting
 * internal machinery with it.
 */

interface CopyAnswerButtonProps {
  answer: string;
  sources?: ChatSource[];
  /** Localized heading for the source block, e.g. "Sources". */
  sourcesHeading: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

/** How long the confirmation stays before the control returns to rest. */
const FEEDBACK_MS = 2000;

export function buildCopyText(
  answer: string,
  sources: ChatSource[] | undefined,
  heading: string,
  formatSource: (source: ChatSource) => string
): string {
  const body = (answer || '').trim();
  if (!sources || sources.length === 0) return body;

  const lines = sources.map((s) => `- ${formatSource(s)}`);
  return `${body}\n\n${heading}:\n${lines.join('\n')}`;
}

export const CopyAnswerButton: React.FC<CopyAnswerButtonProps> = ({
  answer,
  sources,
  sourcesHeading,
}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<CopyState>('idle');
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  const formatSource = useCallback(
    (source: ChatSource) =>
      t('ai.citationLabel', {
        document: source.document,
        page: source.page,
        defaultValue: `${source.document}, page ${source.page}`,
      }),
    [t]
  );

  const handleCopy = useCallback(async () => {
    const text = buildCopyText(answer, sources, sourcesHeading, formatSource);

    if (timerRef.current) window.clearTimeout(timerRef.current);

    try {
      // Called straight from the click, so the browser still counts this as a
      // user gesture. Anything asynchronous before this point can cost the
      // permission on some engines.
      await navigator.clipboard.writeText(text);
      setState('copied');
      // The action is recorded; the answer is not. Copying is a signal about
      // which answers were useful, not a reason to store the text twice.
      trackAnalyticsEvent('AI_ANSWER_COPIED');
    } catch {
      // A refused clipboard is not an error to apologise for repeatedly, and
      // re-requesting would loop. The visitor is told the text is selectable.
      setState('failed');
    }

    timerRef.current = window.setTimeout(() => setState('idle'), FEEDBACK_MS);
  }, [answer, sources, sourcesHeading, formatSource]);

  const label =
    state === 'copied'
      ? t('ai.copied', { defaultValue: 'Copied' })
      : t('ai.copyAnswer', { defaultValue: 'Copy answer' });

  return (
    <div className="chat__answer-actions">
      <button
        type="button"
        className="chat__copy"
        onClick={handleCopy}
        aria-label={label}
        title={label}
        data-state={state}
        data-testid="copy-answer"
      >
        {/* Both icons are always present and one is hidden, so swapping them
            cannot change the control's size mid-interaction. */}
        <span className="chat__copy-icons" aria-hidden="true">
          <Copy size={16} className="chat__copy-icon chat__copy-icon--rest" />
          <Check size={16} className="chat__copy-icon chat__copy-icon--done" />
        </span>
      </button>

      {/* Announced rather than shown as a layout-shifting toast. */}
      <span className="chat__copy-status" role="status" aria-live="polite">
        {state === 'copied' && t('ai.copied', { defaultValue: 'Copied' })}
        {state === 'failed' &&
          t('ai.copyFailed', {
            defaultValue: 'Could not copy. Select the text to copy it manually.',
          })}
      </span>
    </div>
  );
};
