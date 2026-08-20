import React from 'react';
import { Globe, Mail, Linkedin } from 'lucide-react';
import en from '../locales/en.json';

export const Footer: React.FC = () => {
  return (
    <footer style={styles.footer}>
      <div className="container" style={styles.footerContent}>
        <div style={styles.linkRow}>
          <a
            href="https://caspel.com"
            target="_blank"
            rel="noopener noreferrer"
            style={styles.footerLink}
          >
            <Globe size={14} color="var(--color-accent)" />
            <span>{en.footer.website}</span>
          </a>
          <a
            href="mailto:info@caspel.com"
            style={styles.footerLink}
          >
            <Mail size={14} color="var(--color-accent)" />
            <span>{en.footer.email}</span>
          </a>
          <a
            href="https://linkedin.com/company/caspel"
            target="_blank"
            rel="noopener noreferrer"
            style={styles.footerLink}
          >
            <Linkedin size={14} color="var(--color-accent)" />
            <span>LinkedIn</span>
          </a>
        </div>
        <p style={styles.copyright}>{en.footer.copyright}</p>
      </div>
    </footer>
  );
};

const styles: Record<string, React.CSSProperties> = {
  footer: {
    width: '100%',
    padding: '32px 0 40px 0',
    borderTop: '1px solid var(--color-border)',
    backgroundColor: 'rgba(7, 12, 24, 0.9)',
    marginTop: 'auto',
  },
  footerContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    textAlign: 'center',
  },
  linkRow: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: '20px',
  },
  footerLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: 'var(--color-text-secondary)',
    transition: 'color var(--transition-fast)',
  },
  copyright: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
  },
};
