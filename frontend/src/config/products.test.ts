import { describe, it, expect } from 'vitest';
import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';
import {
  PRODUCTS,
  PRODUCT_ORDER,
  PRODUCT_IDENTITIES,
  isProductSlug,
  localizeProduct,
} from './products';

describe('Product Configuration', () => {
  it('contains exactly four primary products, in display order', () => {
    expect(PRODUCT_IDENTITIES.length).toBe(4);
    expect(Object.keys(PRODUCTS)).toEqual(['caspel', 'erp', 'pms', 'irissea']);
    expect(PRODUCT_ORDER).toEqual(['caspel', 'erp', 'pms', 'irissea']);
  });

  it('has stable identity fields for each product', () => {
    PRODUCT_IDENTITIES.forEach((identity) => {
      expect(identity.slug).toBeTruthy();
      expect(identity.presentationUrl).toBeTruthy();
      expect(identity.downloadFilename).toBeTruthy();
      expect(identity.downloadFilename.endsWith('.pdf')).toBe(true);
    });
  });

  it('keeps identity free of any locale binding', () => {
    // Descriptors and summaries must resolve per render. If they were frozen
    // here at import time, switching language would leave the product list in
    // the language the tab first loaded with.
    for (const identity of PRODUCT_IDENTITIES) {
      expect(identity).not.toHaveProperty('descriptor');
      expect(identity).not.toHaveProperty('description');
    }
  });

  it('narrows only known slugs', () => {
    expect(isProductSlug('erp')).toBe(true);
    expect(isProductSlug('caspel')).toBe(true);
    expect(isProductSlug('nope')).toBe(false);
    expect(isProductSlug(undefined)).toBe(false);
  });

  it('resolves display copy through the active language', () => {
    const enT = (key: string) =>
      key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], en) as string;
    const zhT = (key: string) =>
      key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], zhCN) as string;

    const english = localizeProduct(PRODUCTS.erp, enT);
    const chinese = localizeProduct(PRODUCTS.erp, zhT);

    expect(english.descriptor).toBe('Enterprise Resource Planning');
    expect(chinese.descriptor).toBe('企业资源计划');

    // Identity survives the language change untouched.
    expect(chinese.slug).toBe(english.slug);
    expect(chinese.presentationUrl).toBe(english.presentationUrl);
    expect(chinese.downloadFilename).toBe(english.downloadFilename);
    expect(chinese.name).toBe(english.name);
  });
});
