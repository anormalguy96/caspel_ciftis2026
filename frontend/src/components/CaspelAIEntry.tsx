import React from 'react';
import { useTranslation } from 'react-i18next';
import caspelIcon from '../assets/caspel-icon.svg';
import { ActionArrow } from './ActionArrow';

interface CaspelAIEntryProps {
  /** Opens the assistant. A question, when given, is the visitor's opening message. */
  onAsk: (question?: string) => void;
  /**
   * Fired when a visitor looks like they are about to open the assistant --
   * pointer over the card, keyboard focus, or a finger down on it.
   *
   * Used to warm the assistant's chunk. It is only ever a hint: opening works
   * identically if it never fires, and it deliberately does not fire on mere
   * page load, because most visitors never open the assistant at all.
   */
  onIntent?: () => void;
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
export const CaspelAIEntry: React.FC<CaspelAIEntryProps> = ({ onAsk, onIntent }) => {
  const { t } = useTranslation();
  const suggestions = t('aiEntry.suggestions', { returnObjects: true }) as string[];

  return (
    <section
      className="ai-entry u-page-enter"
      aria-labelledby="ai-entry-heading"
      style={{ '--i': 3 } as React.CSSProperties}
      onPointerEnter={onIntent}
      onFocusCapture={onIntent}
      onTouchStart={onIntent}
    >
      <button type="button" className="ai-entry__prompt" onClick={() => onAsk()}>
        {/* The same duotone badge the chat header uses, so opening the
            assistant reads as this card expanding rather than a new surface. */}
        <span className="ai-entry__signal" aria-hidden="true">
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
          <ActionArrow direction="internal" />
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
