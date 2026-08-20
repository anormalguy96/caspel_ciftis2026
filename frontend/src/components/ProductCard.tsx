import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ProductConfig } from '../types';
import { trackAnalyticsEvent } from '../services/analytics';

interface ProductCardProps {
  product: ProductConfig;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    trackAnalyticsEvent(`${product.slug.toUpperCase()}_CLICK`, product.slug);
  };

  return (
    <Link
      to={`/ciftis/product/${product.slug}`}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        ...styles.card,
        borderColor: isHovered ? 'var(--color-accent)' : 'var(--color-border)',
        transform: isHovered ? 'translateY(-2px)' : 'none',
        boxShadow: isHovered ? 'var(--shadow-card-hover)' : 'var(--shadow-card)',
      }}
    >
      <div style={styles.cardLeft}>
        <div style={{ ...styles.badge, borderColor: product.accentColor }}>
          <span style={{ ...styles.badgeText, color: product.accentColor }}>
            {product.badge}
          </span>
        </div>
        <div style={styles.textGroup}>
          <h2 style={styles.productName}>{product.name}</h2>
          <p style={styles.descriptor}>{product.descriptor}</p>
        </div>
      </div>
      <div style={styles.cardRight}>
        <div style={styles.iconCircle}>
          <ChevronRight size={18} color={isHovered ? 'var(--color-accent)' : '#94a3b8'} />
        </div>
      </div>
    </Link>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 20px',
    backgroundColor: 'var(--color-surface-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    marginBottom: '14px',
    textDecoration: 'none',
    transition: 'all var(--transition-normal)',
    cursor: 'pointer',
  },
  cardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  badge: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  badgeText: {
    fontSize: '13px',
    fontWeight: '700',
    letterSpacing: '-0.2px',
  },
  textGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  productName: {
    fontSize: '17px',
    fontWeight: '700',
    color: 'var(--color-text)',
    marginBottom: '2px',
    letterSpacing: '-0.2px',
  },
  descriptor: {
    fontSize: '13px',
    color: 'var(--color-text-secondary)',
    fontWeight: '500',
  },
  cardRight: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  iconCircle: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
