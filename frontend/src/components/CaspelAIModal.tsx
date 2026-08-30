import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, BookOpen, AlertTriangle, RotateCw } from 'lucide-react';
import { ChatMessage } from '../types';
import { sendChatMessage, ChatUnavailableError, ChatRateLimitedError } from '../services/api';
import { getSessionId, trackAnalyticsEvent } from '../services/analytics';
import { useTranslation } from 'react-i18next';
import { currentLocale } from '../i18n';
import { useExitTransition } from '../hooks/useExitTransition';
import { useModalA11y } from '../hooks/useModalA11y';
import { MarkdownRenderer } from './MarkdownRenderer';
import caspelIcon from '../assets/caspel-icon.svg';
import { ActionArrow } from './ActionArrow';
import { SourceCitation } from './SourceCitation';
import { CopyAnswerButton } from './CopyAnswerButton';
import { citationPath } from '../utils/citationLink';

interface CaspelAIModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Opening question from a landing-page suggestion, sent once on open. */
  initialQuestion?: string;
}

interface ChatFailure {
  message: string;
  /** The question to re-send if the visitor taps Retry. */
  question: string;
}

const Dots: React.FC = () => (
  <span className="u-dots" aria-hidden="true">
    <span style={{ ['--i' as string]: 0 }} />
    <span style={{ ['--i' as string]: 1 }} />
    <span style={{ ['--i' as string]: 2 }} />
  </span>
);

export const CaspelAIModal: React.FC<CaspelAIModalProps> = ({ isOpen, onClose, initialQuestion }) => {
  const { t } = useTranslation();
  // Starts empty. A scripted greeting rendered as an assistant bubble is a
  // transcript of a conversation that never happened, and it pushes the real
  // scope statement and the starter questions below it.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef<string | undefined>(undefined);

  const transitionState = useExitTransition(isOpen);
  const panelRef = useModalA11y<HTMLDivElement>(isOpen, onClose);

  /** True until the visitor has actually asked something. */
  const isEmptyState = messages.length === 0 && !isLoading && !failure;

  useEffect(() => {
    if (!isOpen) return;
    // Honour a reduced-motion preference here too: an abrupt jump is the
    // correct behaviour for someone who asked not to be moved.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  }, [messages, failure, isOpen]);

  const ask = useCallback(async (query: string, echoQuestion: boolean) => {
    setFailure(null);
    setIsLoading(true);

    if (echoQuestion) {
      setMessages((prev) => [
        ...prev,
        { id: `user_${Date.now()}`, role: 'user', content: query, timestamp: new Date().toISOString() },
      ]);
      // Count the question without copying its text here: the message is already
      // stored by /api/chat, and logging it twice spreads visitor-entered content
      // across two systems for no benefit.
      trackAnalyticsEvent('AI_QUESTION');
    }

    try {
      const response = await sendChatMessage(getSessionId(), query, currentLocale());
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant_${Date.now()}`,
          role: 'assistant',
          content: response.answer,
          sources: response.sources,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      // A failed call is NOT an answer. Recording it as an assistant message
      // would put a service outage into the transcript as though CASPEL AI had
      // replied, and would count toward answered questions in the exhibition
      // report. It is surfaced as an explicit, retryable failure instead.
      const message =
        error instanceof ChatRateLimitedError
          ? t('ai.rateLimited')
          : error instanceof ChatUnavailableError
            ? t('ai.unavailable')
            : t('ai.networkError');
      setFailure({ question: query, message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSendMessage = useCallback(
    (text: string) => {
      const query = text.trim();
      if (!query || isLoading) return;
      setInputValue('');
      void ask(query, true);
    },
    [ask, isLoading]
  );

  const starterQuestions = (t('ai.questions', { returnObjects: true }) as string[]) ?? [];

  /**
   * A suggestion chosen on the landing page is sent once, when the assistant
   * opens. Guarded by a ref rather than the message list so a re-render, or
   * StrictMode's double effect, cannot ask the same question twice — which
   * would both duplicate the analytics event and spend a second provider call.
   */
  useEffect(() => {
    if (!isOpen) {
      seededRef.current = undefined;
      return;
    }
    if (!initialQuestion || seededRef.current === initialQuestion) return;
    seededRef.current = initialQuestion;
    handleSendMessage(initialQuestion);
  }, [isOpen, initialQuestion, handleSendMessage]);

  if (transitionState === null) return null;

  return (
    <div
      className="modal-backdrop modal-backdrop--chat u-backdrop"
      data-state={transitionState}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal modal--chat u-panel"
        data-state={transitionState}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-modal-title"
      >
        <div className="modal__header">
          <div className="chat__brand">
            <span className="chat__brand-icon" aria-hidden="true">
              <img src={caspelIcon} alt="CASPEL AI" className="chat__caspel-icon" />
            </span>
            <div>
              <h2 className="modal__title" id="ai-modal-title">
                {t('ai.title')}
              </h2>
              <p className="modal__subtitle">{t('ai.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label={t('actions.close')}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/*
          One canvas, two states.

          The layer is no longer unmounted when the conversation starts. A
          visitor crosses that moment in every single session, and swapping a
          saturated field for a differently-coloured document made the
          assistant read as two products joined together. It stays and recedes.

          It also stops moving. Dimming alone would leave motion running behind
          long-form text someone is trying to read, and would keep six promoted
          compositor layers animating for the whole conversation on an
          exhibition phone. Paused at 18% it is atmosphere: the identity holds
          without the cost.

          Six layers, not nine. Three fields carry colour and three rings carry
          structure; past that the overlaps stop reading as distinct light.
        */}
        <div
          className="chat__ambient"
          data-state={isEmptyState ? 'idle' : 'receded'}
          aria-hidden="true"
          data-testid="chat-ambient"
        >
          <span className="chat__ambient-field chat__ambient-field--a" />
          <span className="chat__ambient-field chat__ambient-field--b" />
          <span className="chat__ambient-field chat__ambient-field--c" />
          <span className="chat__ambient-loop chat__ambient-loop--a" />
          <span className="chat__ambient-loop chat__ambient-loop--b" />
          <span className="chat__ambient-loop chat__ambient-loop--c" />
        </div>

        <div
          className="chat__log"
          data-empty={isEmptyState ? 'true' : 'false'}
          role="log"
          aria-live="polite"
        >
          {isEmptyState && (
            <div className="chat__empty" data-testid="chat-empty-state">
              <div className="chat__empty-heading">
                <span className="chat__empty-kicker">{t('ai.title')}</span>
                <p className="chat__empty-scope">{t('ai.scope')}</p>
              </div>

              <span className="chat__suggested-label" id="ai-suggested-label">
                {t('ai.suggestedPrompt')}
              </span>
              <div className="chat__suggested-list" role="group" aria-labelledby="ai-suggested-label">
                {starterQuestions.slice(0, 3).map((q, index) => (
                  <button
                    key={q}
                    type="button"
                    className="chat__suggestion"
                    onClick={() => handleSendMessage(q)}
                  >
                    <span className="chat__suggestion-index" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span>{q}</span>
                    <ActionArrow direction="internal" size="sm" className="chat__suggestion-arrow" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, index) => (
            <div
              key={msg.id}
              className={`chat__row chat__row--${msg.role}`}
              style={{ ['--msg-index' as string]: index }}
            >
              <span className="chat__speaker">
                {msg.role === 'assistant' ? t('ai.title') : t('ai.youLabel')}
              </span>

              <div className={`chat__message chat__message--${msg.role}`}>
                {msg.role === 'assistant' ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  <p className="chat__text">{msg.content}</p>
                )}

                {msg.role === 'assistant' && (
                  <CopyAnswerButton
                    answer={msg.content}
                    sources={msg.sources}
                    sourcesHeading={t('ai.sourcesHeading', { defaultValue: 'Sources' })}
                  />
                )}

                {msg.sources && msg.sources.length > 0 && (
                  <div className="chat__sources">
                    <span className="chat__sources-head">
                      <BookOpen size={13} aria-hidden="true" />
                      <span>{t('ai.sourcesLabel')}</span>
                    </span>
                    {/*
                      Real citations, not decorative pills. Each one opens the
                      approved document at the exact cited page and shows a
                      thumbnail of that slide, so a visitor at the stand can
                      check the claim rather than take it on trust. The title
                      and page are server-owned; the route is built from the
                      registry slug, never from anything the model wrote.
                    */}
                    <ol className="chat__sources-list">
                      {msg.sources.map((src, i) => {
                        const href = citationPath(src);
                        return href ? (
                          <SourceCitation key={`${src.slug}-${src.page}`} source={src} href={href} index={i} />
                        ) : (
                          // A source the server could not make linkable still
                          // gets shown, because the reference itself is true.
                          <li key={i} className="chat__source" lang="en">
                            <cite className="chat__source-doc">{src.document}</cite>
                            <span className="chat__source-page">p.{src.page}</span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="chat__row chat__row--assistant">
              <span className="chat__speaker">{t('ai.title')}</span>
              <div className="chat__message chat__message--assistant chat__message--loading">
                <Dots />
              </div>
            </div>
          )}

          {failure && (
            <div className="chat__failure" role="alert" data-testid="chat-failure">
              <span className="chat__failure-icon" aria-hidden="true">
                <AlertTriangle size={16} />
              </span>
              <div className="chat__failure-body">
                <p className="chat__failure-text">{failure.message}</p>
                <button
                  type="button"
                  className="btn btn--secondary chat__failure-retry"
                  onClick={() => void ask(failure.question, false)}
                  disabled={isLoading}
                >
                  <RotateCw size={15} aria-hidden="true" />
                  <span>{t('actions.retry')}</span>
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <form
          className="chat__composer"
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage(inputValue);
          }}
        >
          <label className="visually-hidden" htmlFor="ai-input">
            {t('ai.placeholder')}
          </label>
          <input
            id="ai-input"
            data-autofocus
            className="field__input chat__input"
            type="text"
            placeholder={t('ai.placeholder')}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoComplete="off"
          />
          <button
            type="submit"
            className="chat__send"
            disabled={!inputValue.trim() || isLoading}
            aria-label={t('ai.sendLabel')}
          >
            <Send size={18} aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  );
};
