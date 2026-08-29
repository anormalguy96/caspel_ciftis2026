import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  applyDocumentLocale,
  matchLocale,
  readStoredLocale,
  resolveLocale,
  writeStoredLocale,
} from '../i18n/locale';

/**
 * Two failure modes this file exists to prevent.
 *
 * A missing Chinese key is invisible in English review and silently falls back
 * to English at a stand in Beijing, which reads as a half-translated product
 * rather than an obvious bug.
 *
 * And locale detection that ignores a stored choice quietly overrides a
 * visitor who already told us what they wanted.
 */

// ==========================================================================
// Locale resource parity
// ==========================================================================

type Shape = Record<string, unknown>;

/** Recursively describes every leaf path and its type. */
function describeShape(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (Array.isArray(value)) {
    out.set(prefix, `array[${value.length}]`);
    value.forEach((item, index) => {
      for (const [k, v] of describeShape(item, `${prefix}[${index}]`)) out.set(k, v);
    });
    return out;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Shape)) {
      const path = prefix ? `${prefix}.${key}` : key;
      for (const [k, v] of describeShape(child, path)) out.set(k, v);
    }
    return out;
  }
  out.set(prefix, typeof value);
  return out;
}

const enShape = describeShape(en);
const zhShape = describeShape(zhCN);

describe('locale resources stay in exact parity', () => {
  it('has no key present in English but missing in Chinese', () => {
    const missing = [...enShape.keys()].filter((k) => !zhShape.has(k));
    expect(missing).toEqual([]);
  });

  it('has no key present in Chinese but missing in English', () => {
    const extra = [...zhShape.keys()].filter((k) => !enShape.has(k));
    expect(extra).toEqual([]);
  });

  it('uses the same type for every corresponding key', () => {
    const mismatched = [...enShape.entries()]
      .filter(([k, type]) => zhShape.get(k) !== type)
      .map(([k, type]) => `${k}: en=${type} zh-CN=${zhShape.get(k)}`);
    expect(mismatched).toEqual([]);
  });

  it('contains no empty string in either resource', () => {
    const empties: string[] = [];
    for (const [name, resource] of [['en', en], ['zh-CN', zhCN]] as const) {
      for (const [path] of describeShape(resource)) {
        const value = path
          .replace(/\[(\d+)\]/g, '.$1')
          .split('.')
          .reduce<unknown>((acc, part) => (acc as Shape)?.[part], resource);
        if (typeof value === 'string' && value.trim() === '') empties.push(`${name}:${path}`);
      }
    }
    expect(empties).toEqual([]);
  });

  it('keeps protected brand, filename and contact metadata identical across locales', () => {
    // Translating a filename breaks the download; translating a legal name or
    // a contact address is simply wrong.
    expect(zhCN.products.caspel.downloadFilename).toBe(en.products.caspel.downloadFilename);
    expect(zhCN.products.erp.downloadFilename).toBe(en.products.erp.downloadFilename);
    expect(zhCN.products.pms.downloadFilename).toBe(en.products.pms.downloadFilename);
    expect(zhCN.products.irissea.downloadFilename).toBe(en.products.irissea.downloadFilename);

    expect(zhCN.products.caspel.name).toBe(en.products.caspel.name);
    expect(zhCN.products.erp.name).toBe(en.products.erp.name);
    expect(zhCN.products.pms.name).toBe(en.products.pms.name);
    expect(zhCN.products.irissea.name).toBe(en.products.irissea.name);

    expect(zhCN.footer.website).toBe(en.footer.website);
    expect(zhCN.footer.email).toBe(en.footer.email);
    expect(zhCN.footer.linkedin).toBe(en.footer.linkedin);
    expect(zhCN.brand.name).toBe(en.brand.name);
  });

  it('preserves protected names inside translated Chinese copy', () => {
    expect(zhCN.brand.exhibition).toContain('CIFTIS 2026');
    expect(zhCN.products.irissea.descriptor).toContain('LRIT');
    expect(zhCN.ai.title).toBe('CASPEL AI');
  });

  it('keeps the same interpolation placeholders in both locales', () => {
    const placeholders = (s: string) => (s.match(/\{\{?\s*\w+\s*\}?\}/g) ?? []).sort();
    expect(placeholders(zhCN.kiosk.returning)).toEqual(placeholders(en.kiosk.returning));
    expect(placeholders(zhCN.presentation.pageCount)).toEqual(placeholders(en.presentation.pageCount));
  });
});

// ==========================================================================
// Detection precedence
// ==========================================================================

describe('locale detection follows stored choice, then browser, then English', () => {
  it('matches the Simplified Chinese tags browsers actually emit', () => {
    for (const tag of ['zh', 'zh-CN', 'zh-Hans', 'zh-Hans-CN', 'zh_cn', 'ZH-HANS']) {
      expect(matchLocale(tag)).toBe('zh-CN');
    }
  });

  it('does not claim Traditional Chinese as Simplified', () => {
    // Serving Simplified to a zh-TW reader as if it were theirs is worse than
    // falling back to English.
    for (const tag of ['zh-TW', 'zh-Hant', 'zh-HK', 'zh-Hant-TW']) {
      expect(matchLocale(tag)).toBeNull();
    }
  });

  it('matches English variants and rejects unrelated languages', () => {
    expect(matchLocale('en')).toBe('en');
    expect(matchLocale('en-GB')).toBe('en');
    expect(matchLocale('en-US')).toBe('en');
    expect(matchLocale('az')).toBeNull();
    expect(matchLocale('fr-FR')).toBeNull();
    expect(matchLocale('')).toBeNull();
    expect(matchLocale(null)).toBeNull();
  });

  it('prefers a stored choice over the browser preference', () => {
    expect(resolveLocale({ stored: 'en', languages: ['zh-CN', 'zh'] })).toBe('en');
    expect(resolveLocale({ stored: 'zh-CN', languages: ['en-US'] })).toBe('zh-CN');
  });

  it('honours the order of navigator.languages', () => {
    expect(resolveLocale({ languages: ['fr-FR', 'zh-CN', 'en'] })).toBe('zh-CN');
    expect(resolveLocale({ languages: ['fr-FR', 'en-GB', 'zh-CN'] })).toBe('en');
  });

  it('falls back to navigator.language, then to English', () => {
    expect(resolveLocale({ languages: [], language: 'zh-Hans' })).toBe('zh-CN');
    expect(resolveLocale({ languages: ['fr'], language: 'de' })).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
  });

  it('ignores a stored value that is not a supported locale', () => {
    expect(resolveLocale({ stored: 'de' as never, languages: ['zh-CN'] })).toBe('zh-CN');
  });
});

// ==========================================================================
// Storage resilience
// ==========================================================================

describe('locale persistence survives unavailable storage', () => {
  it('reads and writes a supported locale', () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(writeStoredLocale('zh-CN', fake)).toBe(true);
    expect(store.get(LOCALE_STORAGE_KEY)).toBe('zh-CN');
    expect(readStoredLocale(fake)).toBe('zh-CN');
  });

  it('does not throw when storage itself throws', () => {
    const hostile = {
      getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
      setItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    };
    // A private window must still render, just without a remembered choice.
    expect(() => readStoredLocale(hostile)).not.toThrow();
    expect(readStoredLocale(hostile)).toBeNull();
    expect(writeStoredLocale('en', hostile)).toBe(false);
  });

  it('rejects a corrupted stored value', () => {
    const fake = { getItem: () => 'klingon', setItem: () => undefined };
    expect(readStoredLocale(fake)).toBeNull();
  });
});

// ==========================================================================
// Document language
// ==========================================================================

describe('document language is kept truthful', () => {
  it('writes the locale onto <html lang>', () => {
    applyDocumentLocale('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    applyDocumentLocale('en');
    expect(document.documentElement.lang).toBe('en');
  });
});

// ==========================================================================
// Language switcher
// ==========================================================================

describe('the language switcher is an accessible two-option control', () => {
  beforeEach(async () => {
    const { changeLocale } = await import('../i18n');
    await act(async () => {
      await changeLocale('en');
    });
  });

  afterEach(async () => {
    const { changeLocale } = await import('../i18n');
    await act(async () => {
      await changeLocale('en');
    });
    vi.restoreAllMocks();
  });

  it('exposes both languages as real buttons in a labelled group', async () => {
    const { LanguageSwitcher } = await import('../components/LanguageSwitcher');
    render(<LanguageSwitcher />);

    const group = screen.getByRole('group', { name: 'Language' });
    expect(group).toBeInTheDocument();

    const english = screen.getByRole('button', { name: 'English' });
    const chinese = screen.getByRole('button', { name: '简体中文' });
    expect(english.tagName).toBe('BUTTON');
    expect(chinese.tagName).toBe('BUTTON');
    // Each label is written in its own language and tagged as such.
    expect(chinese).toHaveAttribute('lang', 'zh-CN');
  });

  it('marks the active language with aria-pressed, not colour alone', async () => {
    const { LanguageSwitcher } = await import('../components/LanguageSwitcher');
    render(<LanguageSwitcher />);

    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '简体中文' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches language live, without a reload, and updates <html lang>', async () => {
    const user = userEvent.setup();
    const { LanguageSwitcher } = await import('../components/LanguageSwitcher');
    render(<LanguageSwitcher />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: '简体中文' }));
    });

    await waitFor(() => expect(document.documentElement.lang).toBe('zh-CN'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '简体中文' })).toHaveAttribute('aria-pressed', 'true')
    );
  });

  it('persists the chosen language', async () => {
    const user = userEvent.setup();
    const { LanguageSwitcher } = await import('../components/LanguageSwitcher');
    render(<LanguageSwitcher />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: '简体中文' }));
    });

    await waitFor(() => expect(readStoredLocale()).toBe('zh-CN'));
  });
});
