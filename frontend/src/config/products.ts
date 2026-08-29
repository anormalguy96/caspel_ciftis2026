import { useTranslation } from 'react-i18next';
import { ProductConfig, ProductSlug } from '../types';
import { presentationStreamUrl } from '../services/presentations';

/**
 * Stable product identity and routing.
 *
 * Nothing here is translated. Slugs, stream URLs and download filenames are
 * identifiers: a localized filename breaks the download, and a localized slug
 * breaks every link ever shared. Display copy is resolved at render time by
 * the hooks below, because binding it at module import would freeze the first
 * language and leave the page in English after the visitor switches.
 *
 * Availability is NOT decided here and cannot be. A presentation is published
 * only when the backend's approved registry carries its exact size, SHA256 and
 * page count, and the file on disk matches all three. Copying a PDF into
 * data/presentations/ does not publish it. See usePresentationManifest and
 * backend/app/core/presentations.py.
 */

export interface ProductIdentity {
  slug: ProductSlug;
  /** Key under `products.` in the locale resources. */
  translationKey: string;
  presentationUrl: string;
  /** Exact approved filename. Never translated. */
  downloadFilename: string;
}

export const PRODUCTS: Record<ProductSlug, ProductIdentity> = {
  caspel: {
    slug: 'caspel',
    translationKey: 'caspel',
    presentationUrl: presentationStreamUrl('caspel'),
    downloadFilename: 'CASPEL_Corporate_Presentation.pdf',
  },
  erp: {
    slug: 'erp',
    translationKey: 'erp',
    presentationUrl: presentationStreamUrl('erp'),
    downloadFilename: 'CASPEL_ERP_Presentation.pdf',
  },
  pms: {
    slug: 'pms',
    translationKey: 'pms',
    presentationUrl: presentationStreamUrl('pms'),
    downloadFilename: 'CASPEL_PMS_Presentation.pdf',
  },
  irissea: {
    slug: 'irissea',
    translationKey: 'irissea',
    presentationUrl: presentationStreamUrl('irissea'),
    downloadFilename: 'IRISSEA_LRIT_Presentation.pdf',
  },
};

/** Display order on the landing page. Not a ranking. */
export const PRODUCT_ORDER: ProductSlug[] = ['caspel', 'erp', 'pms', 'irissea'];

export const PRODUCT_IDENTITIES: ProductIdentity[] = PRODUCT_ORDER.map((slug) => PRODUCTS[slug]);

/** Narrows an arbitrary route param to a known product slug. */
export function isProductSlug(value: string | undefined): value is ProductSlug {
  return !!value && Object.prototype.hasOwnProperty.call(PRODUCTS, value);
}

type Translate = (key: string) => string;

/** Merges stable identity with the copy for the active language. */
export function localizeProduct(identity: ProductIdentity, t: Translate): ProductConfig {
  const base = `products.${identity.translationKey}`;
  return {
    slug: identity.slug,
    // The product name is a brand name and is identical in every locale; it
    // still comes from the resource so a future locale can transliterate it.
    name: t(`${base}.name`),
    descriptor: t(`${base}.descriptor`),
    description: t(`${base}.summary`),
    presentationUrl: identity.presentationUrl,
    downloadFilename: identity.downloadFilename,
  };
}

/** All four products, in display order, in the active language. */
export function useProducts(): ProductConfig[] {
  const { t } = useTranslation();
  return PRODUCT_IDENTITIES.map((identity) => localizeProduct(identity, t));
}

/** One product in the active language, or null for an unknown slug. */
export function useProduct(slug: string | undefined): ProductConfig | null {
  const { t } = useTranslation();
  if (!isProductSlug(slug)) return null;
  return localizeProduct(PRODUCTS[slug], t);
}
