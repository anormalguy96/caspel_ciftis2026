import type { ChatSource } from '../types';

/**
 * The route for a cited slide.
 *
 * Returned as a router-relative path, not an absolute URL. React Router is
 * configured with ROUTER_BASENAME, so it prefixes the deployment base itself --
 * building the base in here as well would produce "/ciftis/ciftis/product/..."
 * in Mode B, which is exactly the duplication this project has hit before.
 *
 * `from=ai` marks the navigation as coming from a citation so the viewer can
 * treat the jump as a focus request rather than an ordinary page load.
 */
export function citationPath(source: Pick<ChatSource, 'slug' | 'page'>): string | null {
  const slug = (source.slug || '').trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;

  const page = Number(source.page);
  if (!Number.isInteger(page) || page < 1) return null;

  return `/product/${slug}?page=${page}&from=ai`;
}

/**
 * Parse a page from a query string, safely.
 *
 * Returns null rather than a guess for anything that is not a positive
 * integer, so "?page=abc", "?page=-3", "?page=1e9" and "?page=" all fall back
 * to the viewer's normal starting page instead of throwing or scrolling
 * somewhere arbitrary.
 */
export function parsePageParam(value: string | null): number | null {
  if (!value) return null;
  if (!/^\d{1,6}$/.test(value)) return null;
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : null;
}

/** Clamp a requested page into a document that really has `pageCount` pages. */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(pageCount) || pageCount < 1) return 1;
  return Math.min(Math.max(1, Math.floor(page)), Math.floor(pageCount));
}
