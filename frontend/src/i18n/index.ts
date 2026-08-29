import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';
import {
  DEFAULT_LOCALE,
  applyDocumentLocale,
  detectLocale,
  writeStoredLocale,
  type SupportedLocale,
} from './locale';

export * from './locale';

/**
 * Both locale resources are bundled, not fetched.
 *
 * An exhibition hall network is exactly where a locale request fails, and a
 * visitor who scanned a QR code to read a presentation should never watch the
 * interface load in the wrong language first. Bundling costs a few kilobytes
 * and removes a failure mode entirely, so no HTTP backend and no
 * language-detector plugin is installed.
 */
export const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
} as const;

const initialLocale = detectLocale();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  // Deterministic: anything missing in Chinese renders the English string
  // rather than the raw key. A visitor should never see "ai.sourcesLabel".
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: ['en', 'zh-CN'],
  interpolation: {
    // React escapes for us; i18next doing it again double-encodes apostrophes.
    escapeValue: false,
  },
  returnNull: false,
});

/**
 * Keeps the tab title and description in the visitor's language.
 *
 * Deliberately limited to those two. Canonical and Open Graph URLs are baked
 * in per deployment mode and are validated at build time, and the locale here
 * is a client-side preference on the same URL -- so rewriting og:locale would
 * claim locale-specific share previews that crawlers, which do not run this
 * code, would never actually see. Documented rather than faked.
 */
export function applyDocumentMetadata(): void {
  if (typeof document === 'undefined') return;

  const title = i18n.t('meta.title');
  if (title && title !== 'meta.title') document.title = title;

  const description = i18n.t('meta.description');
  const tag = document.querySelector('meta[name="description"]');
  if (tag && description && description !== 'meta.description') {
    tag.setAttribute('content', description);
  }
}

applyDocumentLocale(initialLocale);
applyDocumentMetadata();

/**
 * Switches language, persists the choice, and updates <html lang> and the
 * document metadata.
 *
 * Persistence failure is not propagated: a visitor in a private window still
 * gets the language they asked for, they just do not get it remembered.
 */
export async function changeLocale(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
  writeStoredLocale(locale);
  applyDocumentLocale(locale);
  applyDocumentMetadata();
}

/** The active UI locale, narrowed to what the app actually supports. */
export function currentLocale(): SupportedLocale {
  const active = i18n.resolvedLanguage ?? i18n.language;
  return active === 'zh-CN' ? 'zh-CN' : DEFAULT_LOCALE;
}

export default i18n;
