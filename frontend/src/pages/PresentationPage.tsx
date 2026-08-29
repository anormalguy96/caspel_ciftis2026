import React from 'react';
import { Navigate, useParams, useLocation } from 'react-router-dom';
import { isProductSlug } from '../config/products';

/**
 * Compatibility only. The viewer lives at /product/:slug.
 *
 * Anything printed, bookmarked, or shared while the deck sat behind a "View
 * Presentation" step still resolves. Three details matter:
 *
 * `replace` keeps the old URL out of history, so Back returns the visitor to
 * where they actually came from instead of bouncing between the legacy and
 * canonical addresses.
 *
 * The search string and hash are carried across, because a shared link may
 * carry a campaign parameter and losing it silently breaks attribution.
 *
 * No analytics event fires here. A redirect is not a page view, and counting
 * it would inflate PRODUCT_VIEW for every legacy link while the real view
 * event fires a moment later at the destination.
 */
export const PresentationPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { search, hash } = useLocation();

  if (!isProductSlug(slug)) {
    return <Navigate to="/not-found" replace />;
  }

  return <Navigate to={`/product/${slug}${search}${hash}`} replace />;
};
