import React from 'react';
import { useTranslation } from 'react-i18next';
import caspelIcon from '../assets/caspel-icon.svg';

interface CaspelAIEntryProps {
  /** Opens the assistant. A question, when given, is the visitor's opening message. */
  onAsk: (question?: string) => void;
}

/**
 * The assistant's entry point on the landing page.
 *
 * Deliberately not a floating bubble in the corner. At a stand the visitor is
 * holding their own phone, glancing between it and a person talking to them,
 * and a widget pinned over the content hides the very products it is meant to
 * explain. This sits in the flow, immediately after the hero explanation and
 * before the product list, so it is complete within the first screen without
 * covering anything below it.
 *
 * The prompt surface is a real <button>, not a styled div with a click
 * handler. That is what makes Enter and Space work, what puts it in the tab
 * order, and what lets a screen reader announce it as something activatable.
 * One press opens the assistant — there is no second confirmation step.
 *
 * The two suggestions are limited to material the approved corpus actually
 * contains (the Corporate and ERP decks). Suggesting a PMS or IRISSEA question
 * would advertise an answer the retrieval index cannot ground, and the
 * assistant would correctly refuse it in front of the visitor.
 */
export const CaspelAIEntry: React.FC<CaspelAIEntryProps> = ({ onAsk }) => {
  const { t } = useTranslation();
  const suggestions = t('aiEntry.suggestions', { returnObjects: true }) as string[];

  return (
    <section className="ai-entry" aria-labelledby="ai-entry-heading">
      <button type="button" className="ai-entry__prompt" onClick={() => onAsk()}>
        <span className="ai-entry__signal" aria-hidden="true">
          <span className="ai-entry__signal-glow ai-entry__signal-glow--a" />
          <span className="ai-entry__signal-glow ai-entry__signal-glow--b" />
          <span className="ai-entry__signal-loop ai-entry__signal-loop--a" />
          <span className="ai-entry__signal-loop ai-entry__signal-loop--b" />
          <img src={caspelIcon} alt="" className="ai-entry__icon-img" />
        </span>

        <span className="ai-entry__text">
          <span id="ai-entry-heading" className="ai-entry__label">
            {t('aiEntry.label')}
          </span>
          <span className="ai-entry__scope">{t('aiEntry.scope')}</span>
        </span>

        <span className="ai-entry__action">
          <span>{t('aiEntry.action')}</span>
          <span aria-hidden="true">↗</span>
        </span>
      </button>

      {Array.isArray(suggestions) && suggestions.length > 0 && (
        <div className="ai-entry__suggestions">
          <span className="ai-entry__suggestions-label">{t('aiEntry.suggestionsLabel')}</span>
          <div className="ai-entry__suggestion-row">
            {suggestions.slice(0, 2).map((question) => (
              <button
                key={question}
                type="button"
                className="ai-entry__suggestion"
                onClick={() => onAsk(question)}
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
