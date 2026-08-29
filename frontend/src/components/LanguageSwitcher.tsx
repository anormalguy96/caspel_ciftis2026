import React from 'react';
import { useTranslation } from 'react-i18next';
import { changeLocale, currentLocale, SUPPORTED_LOCALES, type SupportedLocale } from '../i18n';

/**
 * Two persistent choices, so two real buttons.
 *
 * A menu button would hide the available languages behind an extra tap and an
 * ambiguous icon; a visitor who cannot read the current language is exactly
 * the person least able to guess what the icon means. Both labels stay visible
 * and each is written in its own language, so "简体中文" is recognisable
 * without reading any English.
 *
 * State is carried by aria-pressed rather than colour alone, and the active
 * option keeps a visible weight and underline so the choice survives greyscale
 * and low-vision viewing.
 */

const LABEL_KEYS: Record<SupportedLocale, string> = {
  en: 'language.english',
  'zh-CN': 'language.chinese',
};

export const LanguageSwitcher: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation();
  const active = currentLocale();

  return (
    <div
      className={`lang-switch${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={t('language.label')}
    >
      {SUPPORTED_LOCALES.map((locale) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            className="lang-switch__option"
            // The pressed state is the accessible name's companion here: a
            // screen reader announces "English, pressed" without needing the
            // visual treatment.
            aria-pressed={isActive}
            lang={locale}
            onClick={() => {
              if (!isActive) void changeLocale(locale);
            }}
          >
            {t(LABEL_KEYS[locale])}
          </button>
        );
      })}
    </div>
  );
};
