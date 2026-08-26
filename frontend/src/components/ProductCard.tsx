import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ProductConfig } from '../types';
import { trackAnalyticsEvent } from '../services/analytics';

interface ProductCardProps {
  product: ProductConfig;
  index?: number;
}

/**
 * A solution entry on the landing page.
 *
 * Carries no ordinal badge. Numbering four unranked products 01–04 implies a
 * sequence that does not exist and is the kind of decoration that makes a
 * corporate site read as a template.
 */
export const ProductCard: React.FC<ProductCardProps> = ({ product, index = 0 }) => {
  const handleClick = () => {
    trackAnalyticsEvent(`${product.slug.toUpperCase()}_CLICK`, product.slug);
  };

  return (
    <Link
      to={`/ciftis/product/${product.slug}`}
      onClick={handleClick}
      className="card-link u-card u-enter"
      // Only the stagger index stays inline: it is per-item data, not styling.
      style={{ ['--i' as string]: index }}
      aria-label={`${product.name} — ${product.descriptor}`}
    >
      <span className="card-link__text">
        <span className="card-link__name">{product.name}</span>
        <span className="card-link__descriptor">{product.descriptor}</span>
      </span>

      <span className="u-card__arrow" aria-hidden="true">
        <ArrowRight size={18} />
      </span>
    </Link>
  );
};
