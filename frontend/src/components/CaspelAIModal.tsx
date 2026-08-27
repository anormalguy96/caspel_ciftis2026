import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, User, BookOpen, AlertTriangle, RotateCw } from 'lucide-react';
import { ChatMessage } from '../types';
import { sendChatMessage, ChatUnavailableError, ChatRateLimitedError } from '../services/api';
import { getSessionId, trackAnalyticsEvent } from '../services/analytics';
import en from '../locales/en.json';
import { useExitTransition } from '../hooks/useExitTransition';
import { useModalA11y } from '../hooks/useModalA11y';
import { MarkdownRenderer } from './MarkdownRenderer';
import caspelIcon from '../assets/caspel-icon.svg';

interface CaspelAIModalProps {
  isOpen: boolean;
  onClose: () => void;
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

export const CaspelAIModal: React.FC<CaspelAIModalProps> = ({ isOpen, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: en.ai.greeting,
      timestamp: new Date().toISOString(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const transitionState = useExitTransition(isOpen);
  const panelRef = useModalA11y<HTMLDivElement>(isOpen, onClose);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      const response = await sendChatMessage(getSessionId(), query);
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
          ? en.ai.rateLimited
          : error instanceof ChatUnavailableError
            ? en.ai.unavailable
            : en.ai.networkError;
      setFailure({ question: query, message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSendMessage = (text: string) => {
    const query = text.trim();
    if (!query || isLoading) return;
    setInputValue('');
    void ask(query, true);
  };

  if (transitionState === null) return null;

  return (
    <div
      className="modal-backdrop u-backdrop"
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
                {en.ai.title}
              </h2>
              <p className="modal__subtitle">{en.ai.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label={en.actions.close}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="chat__log" role="log" aria-live="polite">
          {messages.map((msg) => (
            <div key={msg.id} className={`chat__row chat__row--${msg.role}`}>
              <span className={`chat__avatar chat__avatar--${msg.role}`} aria-hidden="true">
                {msg.role === 'assistant' ? (
                  <img src={caspelIcon} alt="CASPEL AI" className="chat__caspel-icon" />
                ) : (
                  <User size={15} />
                )}
              </span>

              <div className={`chat__bubble chat__bubble--${msg.role}`}>
                {msg.role === 'assistant' ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  <p className="chat__text">{msg.content}</p>
                )}

                {msg.sources && msg.sources.length > 0 && (
                  <div className="chat__sources">
                    <span className="chat__sources-head">
                      <BookOpen size={13} aria-hidden="true" />
                      <span>{en.ai.sourcesLabel}</span>
                    </span>
                    <span className="chat__chips">
                      {msg.sources.map((src, i) => (
                        <span key={i} className="chat__chip">
                          {src.document} — p.{src.page}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="chat__row chat__row--assistant">
              <span className="chat__avatar chat__avatar--assistant" aria-hidden="true">
                <img src={caspelIcon} alt="CASPEL AI" className="chat__caspel-icon" />
              </span>
              <div className="chat__bubble chat__bubble--assistant chat__bubble--loading">
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
                  <span>{en.actions.retry}</span>
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {messages.length <= 2 && !failure && (
          <div className="chat__suggested">
            <span className="chat__suggested-label">{en.ai.suggestedPrompt}</span>
            <div className="chat__suggested-list">
              {en.ai.questions.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="chat__suggestion"
                  onClick={() => handleSendMessage(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <form
          className="chat__composer"
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage(inputValue);
          }}
        >
          <label className="visually-hidden" htmlFor="ai-input">
            {en.ai.placeholder}
          </label>
          <input
            id="ai-input"
            data-autofocus
            className="field__input chat__input"
            type="text"
            placeholder={en.ai.placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoComplete="off"
          />
          <button
            type="submit"
            className="chat__send"
            disabled={!inputValue.trim() || isLoading}
            aria-label="Send message"
          >
            <Send size={18} aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  );
};
