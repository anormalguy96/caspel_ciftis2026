import { ProductConfig, ProductSlug } from '../types';
import { presentationStreamUrl } from '../services/presentations';
import en from '../locales/en.json';

/**
 * Static product copy and routing.
 *
 * Presentation *availability* deliberately lives on the server, not here: the
 * backend reports what is genuinely on disk, so adding a deck to
 * data/presentations/ publishes it with no code change (document.md §31).
 * See usePresentationManifest.
 */
export const PRODUCTS: Record<ProductSlug, ProductConfig> = {
  caspel: {
    slug: 'caspel',
    name: en.products.caspel.name,
    descriptor: en.products.caspel.descriptor,
    description: en.products.caspel.summary,
    presentationUrl: presentationStreamUrl('caspel'),
    downloadFilename: en.products.caspel.downloadFilename,
  },
  erp: {
    slug: 'erp',
    name: en.products.erp.name,
    descriptor: en.products.erp.descriptor,
    description: en.products.erp.summary,
    presentationUrl: presentationStreamUrl('erp'),
    downloadFilename: en.products.erp.downloadFilename,
  },
  pms: {
    slug: 'pms',
    name: en.products.pms.name,
    descriptor: en.products.pms.descriptor,
    description: en.products.pms.summary,
    presentationUrl: presentationStreamUrl('pms'),
    downloadFilename: en.products.pms.downloadFilename,
  },
  irissea: {
    slug: 'irissea',
    name: en.products.irissea.name,
    descriptor: en.products.irissea.descriptor,
    description: en.products.irissea.summary,
    presentationUrl: presentationStreamUrl('irissea'),
    downloadFilename: en.products.irissea.downloadFilename,
  },
};

export const PRODUCT_LIST: ProductConfig[] = [
  PRODUCTS.caspel,
  PRODUCTS.erp,
  PRODUCTS.pms,
  PRODUCTS.irissea,
];

/** Narrows an arbitrary route param to a known product slug. */
export function isProductSlug(value: string | undefined): value is ProductSlug {
  return !!value && Object.prototype.hasOwnProperty.call(PRODUCTS, value);
}
