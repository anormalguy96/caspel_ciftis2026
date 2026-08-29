import { ProductSlug } from '../types';
import { apiUrl } from '../config/paths';

/**
 * Server-reported state of one presentation.
 *
 * Availability is decided by the backend from what is actually on disk — it
 * validates size and the %PDF- signature — so dropping the remaining decks into
 * data/presentations/ makes them live with no code change (document.md §31).
 */
export interface PresentationEntry {
  slug: string;
  name: string;
  available: boolean;
  download_filename: string;
  size_bytes: number | null;
  page_count: number | null;
}

export type PresentationManifest = Record<string, PresentationEntry>;

export async function fetchPresentationManifest(
  signal?: AbortSignal
): Promise<PresentationManifest> {
  const response = await fetch(apiUrl('presentations'), { signal });
  if (!response.ok) {
    throw new Error(`Manifest request failed with status ${response.status}`);
  }
  return response.json();
}

export function presentationStreamUrl(slug: ProductSlug): string {
  return apiUrl(`presentations/${slug}/stream`);
}

export function presentationDownloadUrl(slug: ProductSlug): string {
  return apiUrl(`presentations/${slug}/download`);
}

/**
 * Trigger a download of the presentation.
 *
 * The download endpoint already sends Content-Disposition: attachment, so a
 * plain navigation is enough and avoids buffering a 24 MB file into memory on
 * a phone.
 */
export function downloadPresentation(slug: ProductSlug, filename: string): void {
  const link = document.createElement('a');
  link.href = presentationDownloadUrl(slug);
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
