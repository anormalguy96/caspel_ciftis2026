import previewManifest from '../assets/previews/previews.json';
import caspelSlide from '../assets/previews/caspel-slide-1.webp';
import erpSlide from '../assets/previews/erp-slide-1.webp';

import type { ProductSlug } from '../types';

/**
 * The real first slide of each approved deck, as an image.
 *
 * Page one of the Corporate deck is 1.7 MB of its own bytes and page one of the
 * ERP deck is 1.5 MB, which is a 7-8 second transfer floor on the documented
 * throttled-mobile profile before a single request is made. Byte ranges, chunk
 * sizes and linearization were each measured and none of them beat that
 * arithmetic. A WebP of the same page is ~50 KB.
 *
 * So the visitor is shown the actual first slide while PDF.js starts behind it.
 * This is not a skeleton and not a placeholder: it is a render of the approved
 * PDF, produced by `backend/scripts/build_slide_previews.py`, which refuses to
 * run against a source whose SHA256 does not match the approved digest.
 *
 * Dimensions come from the generated manifest rather than being typed here, so
 * the reserved box cannot drift from the image and reintroduce layout shift.
 * The images are imported as modules, so Vite hashes them, fingerprints them for
 * immutable caching, and resolves them against the deployment's base path --
 * which is what keeps Mode A and Mode B correct without a second code path.
 */

export interface SlidePreview {
  src: string;
  width: number;
  height: number;
  /** SHA256 of the source PDF this was rendered from. */
  sourceSha256: string;
  sourcePage: number;
}

interface ManifestEntry {
  width: number;
  height: number;
  source_sha256: string;
  source_page: number;
}

const SOURCES: Partial<Record<ProductSlug, string>> = {
  caspel: caspelSlide,
  erp: erpSlide,
};

const manifest = previewManifest as Record<string, ManifestEntry>;

/**
 * The first-slide preview for a product, or null when there is none.
 *
 * PMS and IRISSEA have no approved deck yet, so they have no preview and the
 * viewer simply behaves as it did before. Returning null rather than a
 * stand-in matters: an invented first slide for a product whose deck does not
 * exist would be a fabrication.
 */
export function getSlidePreview(slug: ProductSlug): SlidePreview | null {
  const src = SOURCES[slug];
  const entry = manifest[slug];
  if (!src || !entry) return null;
  return {
    src,
    width: entry.width,
    height: entry.height,
    sourceSha256: entry.source_sha256,
    sourcePage: entry.source_page,
  };
}
