import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import caspelLogo from '../assets/caspel-logo-horizontal.svg';
import ciftisLogo from '../assets/ciftis-logo.png';
import { LanguageSwitcher } from './LanguageSwitcher';

/**
 * CASPEL leads; the CIFTIS mark accompanies it.
 *
 * The event logo is the artwork supplied for the exhibition, bundled locally
 * rather than hotlinked, so the stand does not depend on the venue network
 * reaching a third-party host. CASPEL stays first and larger: this is CASPEL's
 * hub at CIFTIS, not a CIFTIS site.
 *
 * The width/height on each image are the file's own intrinsic dimensions, not
 * the size it renders at. The browser uses them only for the aspect ratio it
 * reserves before the image arrives; CSS sets the real size. Passing the
 * rendered box instead reserves the wrong shape and the page jumps on load.
 *
 * The event line is hidden on narrow screens rather than clipped: the same
 * text already leads the hero, and the language control must never be squeezed
 * out to make room for a duplicate.
 */
export const Header: React.FC = () => {
  const { t } = useTranslation();

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link to="/" className="site-header__brand" aria-label={t('brand.homeLabel')}>
          <img src={caspelLogo} alt="CASPEL" className="site-header__logo" width={210} height={50} loading="eager" />
          <span className="site-header__logo-divider" aria-hidden="true" />
          <img src={ciftisLogo} alt="CIFTIS 2026" className="site-header__ciftis-logo" width={297} height={231} loading="eager" />
        </Link>

        <p className="site-header__event">{t('brand.exhibition')}</p>

        <LanguageSwitcher className="site-header__lang" />
      </div>
    </header>
  );
};
