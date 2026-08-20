import React from 'react';
import en from '../locales/en.json';

export const Hero: React.FC = () => {
  return (
    <section style={styles.heroSection}>
      <div className="container">
        <div style={styles.badgeContainer}>
          <span style={styles.badgeText}>CASPEL ENTERPRISE TECHNOLOGY</span>
        </div>
        <h1 style={styles.title}>{en.hero.title}</h1>
        <p style={styles.subtitle}>{en.hero.subtitle}</p>
      </div>
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  heroSection: {
    padding: '32px 0 20px 0',
    textAlign: 'center',
  },
  badgeContainer: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: 'var(--radius-full)',
    background: 'rgba(0, 194, 255, 0.1)',
    border: '1px solid rgba(0, 194, 255, 0.25)',
    marginBottom: '14px',
  },
  badgeText: {
    fontSize: '11px',
    fontWeight: '700',
    letterSpacing: '1px',
    color: 'var(--color-accent)',
  },
  title: {
    fontSize: '28px',
    fontWeight: '800',
    letterSpacing: '-0.5px',
    color: 'var(--color-text)',
    marginBottom: '10px',
    lineHeight: 1.2,
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.5,
    maxWidth: '520px',
    margin: '0 auto',
  },
};
