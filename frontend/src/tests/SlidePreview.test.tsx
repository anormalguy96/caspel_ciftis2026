import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getSlidePreview } from '../config/slidePreviews';
import previewManifest from '../assets/previews/previews.json';

/**
 * The first-slide preview is the first thing a visitor sees on a viewer route,
 * and it claims to be the deck's real first page.
 *
 * That claim is the thing worth testing. An image that merely looks plausible
 * would be a fabrication presented as the client's material, so provenance is
 * checked against the generator's recorded digests rather than assumed.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = join(ROOT, 'src', 'assets', 'previews');

/** Recorded from app.core.presentations, the same digests the API enforces. */
const APPROVED_SOURCES: Record<string, string> = {
  caspel: '051796d6e7e6f9243739b2985a0d8d04525e55d8ef6067ba78aa3aa9e1811f03',
  erp: 'e7033d04ff59141572ffd4cdd57163c031d7faa39052c51e29424dd0cf50aab7',
};

describe('slide preview provenance', () => {
  it('records the approved source PDF for every preview', () => {
    for (const [slug, expected] of Object.entries(APPROVED_SOURCES)) {
      const entry = (previewManifest as Record<string, { source_sha256: string }>)[slug];
      expect(entry, `no manifest entry for ${slug}`).toBeTruthy();
      // A preview rendered from an unapproved file would look authoritative and
      // be wrong. This is the digest the backend refuses to serve without.
      expect(entry.source_sha256).toBe(expected);
    }
  });

  it('was rendered from page one', () => {
    for (const slug of Object.keys(APPROVED_SOURCES)) {
      const entry = (previewManifest as Record<string, { source_page: number }>)[slug];
      expect(entry.source_page).toBe(1);
    }
  });

  it('matches the bytes the generator recorded', () => {
    for (const slug of Object.keys(APPROVED_SOURCES)) {
      const entry = (previewManifest as Record<string, { sha256: string; bytes: number }>)[slug];
      const file = join(ASSETS, `${slug}-slide-1.webp`);
      expect(existsSync(file), `${slug} preview is missing`).toBe(true);

      const data = readFileSync(file);
      // If the image is edited, retouched or replaced, this fails.
      expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);
      expect(data.length).toBe(entry.bytes);
    }
  });

  it('stays inside the transfer budget it exists to respect', () => {
    // The whole point is that a slide arrives in under a second on a throttled
    // link. A preview that grew to PDF-page size would defeat itself.
    for (const slug of Object.keys(APPROVED_SOURCES)) {
      const size = statSync(join(ASSETS, `${slug}-slide-1.webp`)).size;
      expect(size, `${slug} preview is ${size} bytes`).toBeLessThanOrEqual(150 * 1024);
    }
  });

  it('exposes intrinsic dimensions so the box can be reserved', () => {
    for (const slug of Object.keys(APPROVED_SOURCES)) {
      const preview = getSlidePreview(slug as 'caspel' | 'erp');
      expect(preview).not.toBeNull();
      // Without both, the reserved box cannot match the page and the canvas
      // swap would shift the layout.
      expect(preview!.width).toBeGreaterThan(0);
      expect(preview!.height).toBeGreaterThan(0);
    }
  });

  it('reserves the same aspect ratio for both decks as their pages', () => {
    // Both decks are 16:9 slides. The preview is rendered from the page itself,
    // so any drift here means the render pipeline changed shape.
    for (const slug of Object.keys(APPROVED_SOURCES)) {
      const preview = getSlidePreview(slug as 'caspel' | 'erp')!;
      const ratio = preview.width / preview.height;
      expect(ratio).toBeGreaterThan(1.7);
      expect(ratio).toBeLessThan(1.8);
    }
  });

  it('has no preview for a product with no approved deck', () => {
    // PMS and IRISSEA have no client file yet. Inventing a first slide for them
    // would be a fabrication, so there is deliberately nothing to show.
    expect(getSlidePreview('pms')).toBeNull();
    expect(getSlidePreview('irissea')).toBeNull();
  });

  it('ships exactly the previews the manifest describes', () => {
    // A stray image in this directory would be committed and served without
    // any provenance record.
    const images = readdirSync(ASSETS).filter((f) => f.endsWith('.webp'));
    expect(images.sort()).toEqual(['caspel-slide-1.webp', 'erp-slide-1.webp']);
  });

  it('is a WebP, not a renamed something else', () => {
    for (const slug of Object.keys(APPROVED_SOURCES)) {
      const data = readFileSync(join(ASSETS, `${slug}-slide-1.webp`));
      expect(data.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(data.subarray(8, 12).toString('ascii')).toBe('WEBP');
    }
  });
});
