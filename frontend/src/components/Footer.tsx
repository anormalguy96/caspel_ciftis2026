import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActionArrow } from './ActionArrow';
import caspelLogo from '../assets/caspel-logo-horizontal.svg';
import ciftisLogo from '../assets/ciftis-logo.png';

/**
 * Contact details come from the locale resources so they can be corrected
 * without touching markup. Every link here points at a real destination —
 * decorative links that go nowhere are worse than no link at all.
 *
 * The address, mailbox and profile URL are identical in every locale: they are
 * contact identifiers, not copy. Only the visible labels around them change.
 *
 * The CIFTIS mark sits beside the CASPEL wordmark, bundled locally rather than
 * hotlinked. Image width/height are the files' intrinsic dimensions so the
 * reserved aspect ratio is correct; CSS controls the rendered size.
 */
export const Footer: React.FC = () => {
  const { t } = useTranslation();

  /**
   * Two different questions, previously answered by one flag.
   *
   * newTab decides target/rel: a mailto: must NOT open a browser tab.
   * leaves decides the arrow: a mailto: hands the visitor to a mail client,
   * so it does leave the experience. The old single `external` flag drove
   * both and was therefore forced to be wrong about the address — it showed
   * the stays-here arrow on the one link that departs.
   */
  const links = [
    { key: 'website', href: t('footer.website'), label: t('footer.websiteLabel'), newTab: true, leaves: true },
    { key: 'email', href: `mailto:${t('footer.email')}`, label: t('footer.email'), newTab: false, leaves: true },
    { key: 'linkedin', href: t('footer.linkedin'), label: 'LinkedIn', newTab: true, leaves: true },
  ];

  return (
    <footer className="site-footer">
      <div className="container site-footer__inner u-scroll-reveal-subtle">
        <div className="site-footer__brand">
          <div className="site-footer__logos">
            <img src={caspelLogo} alt="CASPEL" className="site-footer__logo" width={168} height={40} loading="lazy" />
            <span className="site-footer__logo-divider" aria-hidden="true" />
            <img src={ciftisLogo} alt="CIFTIS 2026" className="site-footer__ciftis-logo" width={297} height={231} loading="lazy" />
          </div>
        </div>

        <nav className="site-footer__links" aria-label={t('footer.contactLabel')}>
          {links.map(({ key, href, label, newTab, leaves }) => (
            <a
              key={key}
              href={href}
              className="site-footer__link u-link"
              {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              <span>{label}</span>
              <ActionArrow
                direction={leaves ? 'external' : 'internal'}
                size="sm"
                className="site-footer__link-arrow"
              />
            </a>
          ))}
        </nav>

        <p className="site-footer__copyright">{t('footer.copyright')}</p>
      </div>
    </footer>
  );
};
