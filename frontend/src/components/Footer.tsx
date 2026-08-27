import React from 'react';
import { Globe, Mail, Linkedin } from 'lucide-react';
import en from '../locales/en.json';
import caspelLogo from '../assets/caspel-logo-horizontal.svg';
import ciftisLogo from '../assets/ciftis-logo.png';

/**
 * Contact details come from en.json so they can be corrected without touching
 * markup. Every link here points at a real destination — decorative links that
 * go nowhere are worse than no link at all.
 *
 * The CIFTIS mark sits beside the CASPEL wordmark, bundled locally rather than
 * hotlinked. Image width/height are the files' intrinsic dimensions so the
 * reserved aspect ratio is correct; CSS controls the rendered size.
 */
const LINKS = [
  { key: 'website', href: en.footer.website, label: en.footer.websiteLabel, Icon: Globe, external: true },
  { key: 'email', href: `mailto:${en.footer.email}`, label: en.footer.email, Icon: Mail, external: false },
  { key: 'linkedin', href: en.footer.linkedin, label: 'LinkedIn', Icon: Linkedin, external: true },
];

export const Footer: React.FC = () => (
  <footer className="site-footer">
    <div className="container site-footer__inner">
      <div className="site-footer__brand">
        <div className="site-footer__logos">
          <img src={caspelLogo} alt="CASPEL" className="site-footer__logo" width={168} height={40} loading="lazy" />
          <span className="site-footer__logo-divider" aria-hidden="true" />
          <img src={ciftisLogo} alt="CIFTIS 2026" className="site-footer__ciftis-logo" width={297} height={231} loading="lazy" />
        </div>
        <p className="site-footer__event">{en.brand.exhibition}</p>
      </div>

      <nav className="site-footer__links" aria-label="Contact CASPEL">
        {LINKS.map(({ key, href, label, Icon, external }) => (
          <a
            key={key}
            href={href}
            className="site-footer__link u-link"
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
          </a>
        ))}
      </nav>

      <p className="site-footer__copyright">{en.footer.copyright}</p>
    </div>
  </footer>
);
