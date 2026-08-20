import { describe, it, expect } from 'vitest';
import { PRODUCTS, PRODUCT_LIST } from './products';

describe('Product Configuration', () => {
  it('contains exactly four primary products', () => {
    expect(PRODUCT_LIST.length).toBe(4);
    expect(Object.keys(PRODUCTS)).toEqual(['caspel', 'erp', 'pms', 'irissea']);
  });

  it('has all required fields for each product', () => {
    PRODUCT_LIST.forEach((prod) => {
      expect(prod.slug).toBeTruthy();
      expect(prod.name).toBeTruthy();
      expect(prod.descriptor).toBeTruthy();
      expect(prod.presentationUrl).toBeTruthy();
      expect(prod.downloadFilename).toBeTruthy();
      expect(prod.downloadFilename.endsWith('.pdf')).toBe(true);
    });
  });
});
