import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Sparkles, Bot, User, BookOpen } from 'lucide-react';
import { ChatMessage } from '../types';
import { sendChatMessage } from '../services/api';
import { getSessionId, trackAnalyticsEvent } from '../services/analytics';
import en from '../locales/en.json';

interface CaspelAIModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  const handleSendMessage = async (text: string) => {
    const query = text.trim();
    if (!query || isLoading) return;

    const userMessage: ChatMessage = {
      id: 'user_' + Date.now(),
      role: 'user',
      content: query,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    trackAnalyticsEvent('AI_QUESTION', undefined, { query });

    try {
      const sessionId = getSessionId();
      const response = await sendChatMessage(sessionId, query);

      const assistantMessage: ChatMessage = {
        id: 'assistant_' + Date.now(),
        role: 'assistant',
        content: response.answer,
        sources: response.sources,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      const errorMessage: ChatMessage = {
        id: 'err_' + Date.now(),
        role: 'assistant',
        content: 'CASPEL AI is temporarily offline. Please explore our presentations or request a demo with our team.',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div
        style={styles.modalContent}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerTitleGroup}>
            <div style={styles.aiBadge}>
              <Sparkles size={18} color="#00c2ff" />
            </div>
            <div>
              <h2 style={styles.title}>{en.ai.title}</h2>
              <p style={styles.subtitle}>{en.ai.subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close AI chat">
            <X size={20} color="#94a3b8" />
          </button>
        </div>

        {/* Message Log */}
        <div style={styles.messagesContainer}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                ...styles.messageRow,
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              {msg.role === 'assistant' && (
                <div style={styles.avatarAssistant}>
                  <Bot size={16} color="#00c2ff" />
                </div>
              )}

              <div
                style={{
                  ...styles.bubble,
                  backgroundColor: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-surface-elevated)',
                  borderColor: msg.role === 'user' ? 'var(--color-primary-hover)' : 'var(--color-border)',
                }}
              >
                <div style={styles.bubbleText}>{msg.content}</div>

                {msg.sources && msg.sources.length > 0 && (
                  <div style={styles.sourcesBox}>
                    <div style={styles.sourcesHeader}>
                      <BookOpen size={12} color="var(--color-accent)" />
                      <span>{en.ai.sourcesLabel}</span>
                    </div>
                    <div style={styles.sourceChips}>
                      {msg.sources.map((src, i) => (
                        <span key={i} style={styles.sourceChip}>
                          {src.document} — p.{src.page}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {msg.role === 'user' && (
                <div style={styles.avatarUser}>
                  <User size={16} color="#ffffff" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div style={styles.loadingRow}>
              <div style={styles.avatarAssistant}>
                <Bot size={16} color="#00c2ff" />
              </div>
              <div style={styles.loadingBubble}>
                <div style={styles.dotPulse}></div>
                <span style={styles.loadingText}>CASPEL AI is thinking...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Suggested Questions */}
        {messages.length <= 2 && (
          <div style={styles.suggestedContainer}>
            <span style={styles.suggestedLabel}>{en.ai.suggestedPrompt}</span>
            <div style={styles.suggestedList}>
              {en.ai.questions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(q)}
                  style={styles.suggestedBtn}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage(inputValue);
          }}
          style={styles.inputBar}
        >
          <input
            type="text"
            placeholder={en.ai.placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            style={styles.chatInput}
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            style={{
              ...styles.sendBtn,
              opacity: !inputValue.trim() || isLoading ? 0.5 : 1,
            }}
            aria-label="Send message"
          >
            <Send size={18} color="#ffffff" />
          </button>
        </form>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 100,
  },
  modalContent: {
    width: '100%',
    maxWidth: '560px',
    height: '80vh',
    maxHeight: '700px',
    backgroundColor: 'var(--color-surface)',
    borderTopLeftRadius: 'var(--radius-lg)',
    borderTopRightRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--shadow-modal)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '16px 20px',
    borderBottom: '1px solid var(--color-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(14, 23, 42, 0.95)',
  },
  headerTitleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  aiBadge: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    backgroundColor: 'rgba(0, 194, 255, 0.15)',
    border: '1px solid rgba(0, 194, 255, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: '17px',
    fontWeight: '800',
    color: 'var(--color-text)',
    lineHeight: 1.1,
  },
  subtitle: {
    fontSize: '11px',
    color: 'var(--color-text-secondary)',
  },
  closeBtn: {
    padding: '6px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  messagesContainer: {
    flex: 1,
    padding: '16px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  messageRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    width: '100%',
  },
  avatarAssistant: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: 'rgba(0, 194, 255, 0.15)',
    border: '1px solid rgba(0, 194, 255, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: '2px',
  },
  avatarUser: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: 'var(--color-primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: '2px',
  },
  bubble: {
    maxWidth: '82%',
    padding: '12px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid',
  },
  bubbleText: {
    fontSize: '14px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    color: 'var(--color-text)',
  },
  sourcesBox: {
    marginTop: '10px',
    paddingTop: '8px',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
  },
  sourcesHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--color-accent)',
    marginBottom: '6px',
  },
  sourceChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  sourceChip: {
    fontSize: '11px',
    padding: '3px 8px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(0, 194, 255, 0.1)',
    border: '1px solid rgba(0, 194, 255, 0.2)',
    color: 'var(--color-text-secondary)',
  },
  loadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  loadingBubble: {
    padding: '10px 14px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface-elevated)',
    border: '1px solid var(--color-border)',
  },
  loadingText: {
    fontSize: '13px',
    color: 'var(--color-text-secondary)',
    fontStyle: 'italic',
  },
  suggestedContainer: {
    padding: '10px 16px',
    borderTop: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface-card)',
  },
  suggestedLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--color-text-secondary)',
    display: 'block',
    marginBottom: '8px',
  },
  suggestedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  suggestedBtn: {
    padding: '8px 12px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--color-surface-elevated)',
    border: '1px solid var(--color-border)',
    fontSize: '12px',
    color: 'var(--color-text)',
    textAlign: 'left',
    transition: 'background-color var(--transition-fast)',
  },
  inputBar: {
    padding: '12px 16px',
    borderTop: '1px solid var(--color-border)',
    display: 'flex',
    gap: '10px',
    backgroundColor: 'var(--color-surface)',
  },
  chatInput: {
    flex: 1,
    padding: '12px 16px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface-elevated)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    fontSize: '14px',
  },
  sendBtn: {
    padding: '0 16px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-accent-gradient)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
