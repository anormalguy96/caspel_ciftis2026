import React from 'react';
import { useTranslation } from 'react-i18next';

export const Hero: React.FC = () => {
  const { t } = useTranslation();

  return (
    <section className="hero">
      <div className="container hero__inner">
        <p className="hero__kicker u-page-enter" style={{ '--i': 0 } as React.CSSProperties}>{t('brand.tagline')}</p>
        <h1 className="hero__title u-page-enter" style={{ '--i': 1 } as React.CSSProperties}>{t('hero.title')}</h1>
        <p className="hero__subtitle u-page-enter" style={{ '--i': 2 } as React.CSSProperties}>{t('hero.subtitle')}</p>
      </div>
    </section>
  );
};
