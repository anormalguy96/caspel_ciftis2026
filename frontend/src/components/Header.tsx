import React from 'react';
import { Link } from 'react-router-dom';
import en from '../locales/en.json';
import caspelLogo from '../assets/caspel-logo-horizontal.svg';

/**
 * The CASPEL wordmark is the only logo shown.
 *
 * CIFTIS is identified in text. Redrawing another organisation's mark from a
 * photograph produces something that is close enough to look official and
 * wrong enough to be a misrepresentation, so the event is named rather than
 * badged until CIFTIS supplies artwork.
 */
export const Header: React.FC = () => (
  <header className="site-header">
    <div className="container site-header__inner">
      <Link to="/" className="site-header__brand" aria-label="CASPEL — CIFTIS 2026 Digital Hub">
        <img src={caspelLogo} alt="CASPEL" className="site-header__logo" width={210} height={50} loading="eager" />
      </Link>

      <p className="site-header__event">{en.brand.exhibition}</p>
    </div>
  </header>
);
