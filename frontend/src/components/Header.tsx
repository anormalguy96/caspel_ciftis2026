import React from 'react';
import { Link } from 'react-router-dom';
import en from '../locales/en.json';

export const Header: React.FC = () => {
  return (
    <header style={styles.header}>
      <div className="container" style={styles.headerInner}>
        <Link to="/ciftis" style={styles.brandLink}>
          <div style={styles.logoBadge}>
            <span style={styles.logoIcon}>C</span>
          </div>
          <div style={styles.brandTextGroup}>
            <span style={styles.brandName}>{en.brand.name}</span>
            <span style={styles.brandTagline}>{en.brand.exhibition}</span>
          </div>
        </Link>
        <div style={styles.pillBadge}>
          <span style={styles.onlineDot}></span>
          <span style={styles.hubText}>{en.brand.tagline}</span>
        </div>
      </div>
    </header>
  );
};

const styles: Record<string, React.CSSProperties> = {
  header: {
    width: '100%',
    padding: '16px 0',
    backgroundColor: 'rgba(7, 12, 24, 0.85)',
    backdropFilter: 'blur(12px)',
    borderBottom: '1px solid var(--color-border)',
    position: 'sticky',
    top: 0,
    zIndex: 40,
  },
  headerInner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    textDecoration: 'none',
  },
  logoBadge: {
    width: '38px',
    height: '38px',
    borderRadius: '10px',
    background: 'var(--color-accent-gradient)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 15px rgba(0, 194, 255, 0.35)',
  },
  logoIcon: {
    fontSize: '22px',
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: '-0.5px',
  },
  brandTextGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  brandName: {
    fontSize: '18px',
    fontWeight: '800',
    letterSpacing: '1px',
    color: '#ffffff',
    lineHeight: 1.1,
  },
  brandTagline: {
    fontSize: '11px',
    color: 'var(--color-text-secondary)',
    fontWeight: '500',
    letterSpacing: '0.5px',
  },
  pillBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: 'var(--radius-full)',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
  },
  onlineDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: 'var(--color-success)',
    boxShadow: '0 0 6px var(--color-success)',
  },
  hubText: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--color-text-secondary)',
    letterSpacing: '0.3px',
  },
};
