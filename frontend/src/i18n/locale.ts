/**
 * Locale resolution for the exhibition hub.
 *
 * Deliberately pure and dependency-free so the precedence rules can be tested
 * without booting i18next or a browser. Detection is limited to what the
 * visitor's own browser reports: no IP lookup, no geolocation, no timezone
 * inference, no remote call. A visitor at a Beijing stand may be reading in
 * English, and guessing from network location gets that wrong.
 */

export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

/** Namespaced so it cannot collide with anything else on the origin. */
export const LOCALE_STORAGE_KEY = 'caspel_ciftis_locale';

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Maps one BCP 47 tag to a supported UI locale, or null if it matches none.
 *
 * Simplified Chinese arrives under several tags depending on the platform:
 * "zh-CN" on most desktops, "zh-Hans" or "zh-Hans-CN" on iOS and newer
 * Android, and bare "zh" from some browsers. Matching only "zh-CN" would show
 * English to a large share of the visitors this exists for.
 *
 * Traditional Chinese is deliberately NOT matched. zh-TW and zh-HK readers are
 * better served by English than by Simplified text presented as if it were
 * theirs, until a Traditional resource exists.
 */
export function matchLocale(tag: string | null | undefined): SupportedLocale | null {
  if (typeof tag !== 'string' || tag.trim() === '') return null;

  const normalized = tag.trim().toLowerCase().replace(/_/g, '-');
  const [language, ...rest] = normalized.split('-');
  const subtags = new Set(rest);

  if (language === 'zh') {
    if (subtags.has('hant') || subtags.has('tw') || subtags.has('hk') || subtags.has('mo')) {
      return null;
    }
    return 'zh-CN';
  }

  if (language === 'en') return 'en';

  return null;
}

/** Reads the stored preference, tolerating storage that throws or is disabled. */
export function readStoredLocale(storage?: Pick<Storage, 'getItem'>): SupportedLocale | null {
  try {
    const store = storage ?? globalThis.localStorage;
    const stored = store?.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(stored) ? stored : null;
  } catch {
    // Private mode, blocked cookies, or a partitioned context. Not an error:
    // the visitor simply gets detection instead of a remembered choice.
    return null;
  }
}

/** Persists the preference. Never throws — a failure to remember is not fatal. */
export function writeStoredLocale(
  locale: SupportedLocale,
  storage?: Pick<Storage, 'setItem'>
): boolean {
  try {
    const store = storage ?? globalThis.localStorage;
    store?.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

export interface DetectionSources {
  stored?: SupportedLocale | null;
  languages?: readonly string[] | null;
  language?: string | null;
}

/**
 * Precedence: an explicit stored choice, then the browser's ordered
 * preferences, then English.
 *
 * A stored choice always wins. Someone who switched to English on a
 * Chinese-configured device meant it, and re-detecting on every visit would
 * silently undo them.
 */
export function resolveLocale(sources: DetectionSources = {}): SupportedLocale {
  if (isSupportedLocale(sources.stored)) return sources.stored;

  // navigator.languages is ordered by the visitor's own preference; honour
  // that order rather than looking for a favourite tag anywhere in the list.
  for (const tag of sources.languages ?? []) {
    const matched = matchLocale(tag);
    if (matched) return matched;
  }

  const fromSingle = matchLocale(sources.language);
  if (fromSingle) return fromSingle;

  return DEFAULT_LOCALE;
}

/** Reads detection inputs from the current browser, if there is one. */
export function detectLocale(): SupportedLocale {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return resolveLocale({
    stored: readStoredLocale(),
    languages: nav?.languages,
    language: nav?.language,
  });
}

/**
 * Keeps <html lang> truthful. Assistive technology chooses a voice and
 * pronunciation from this attribute, so a Chinese page announced as English is
 * read as gibberish.
 */
export function applyDocumentLocale(locale: SupportedLocale, doc?: Document): void {
  const target = doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!target?.documentElement) return;
  target.documentElement.lang = locale;
}
