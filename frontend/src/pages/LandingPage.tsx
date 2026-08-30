import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Header } from '../components/Header';
import { Hero } from '../components/Hero';
import { CaspelAIEntry } from '../components/CaspelAIEntry';
import { ProductCard } from '../components/ProductCard';
import { RequestDemoModal } from '../components/RequestDemoModal';
import { CaspelAIModal } from '../components/CaspelAIModal';
import { Footer } from '../components/Footer';
import { ActionArrow } from '../components/ActionArrow';
import { useProducts } from '../config/products';
import { trackAnalyticsEvent } from '../services/analytics';

/**
 * Order on this page is a decision, not a layout accident.
 *
 * A visitor arrives by scanning a code at a stand, on a phone, standing up,
 * often mid-conversation. What they need within the first screen is: whose
 * stand this is, what the page is for, that they can ask questions, and which
 * presentations exist. The assistant therefore sits between the hero and the
 * product list rather than in a banner further down, where it previously
 * started below the fold at 390x844 and was effectively invisible.
 *
 * The demo and contact actions come last. They matter, but a visitor who has
 * not yet seen a presentation has no reason to request one.
 */
let hasVisitedLanding = false;

export const LandingPage: React.FC = () => {
  const { t } = useTranslation();
  const products = useProducts();

  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [seedQuestion, setSeedQuestion] = useState<string | undefined>(undefined);
  const [isReturnNav] = useState(() => hasVisitedLanding);

  useEffect(() => {
    trackAnalyticsEvent('LANDING_OPEN');
    hasVisitedLanding = true;
  }, []);

  const handleOpenDemo = () => {
    trackAnalyticsEvent('DEMO_OPEN');
    setIsDemoModalOpen(true);
  };

  const handleOpenAi = useCallback((question?: string) => {
    trackAnalyticsEvent('AI_OPEN');
    setSeedQuestion(question);
    setIsAiModalOpen(true);
  }, []);

  const closeAi = useCallback(() => {
    setIsAiModalOpen(false);
    setSeedQuestion(undefined);
  }, []);

  return (
    <div className="page page--landing">
      <Header />
      <main className="landing">
        <div className="landing-stage">
          <Hero />
          <div className="container landing-stage__assistant">
            <CaspelAIEntry onAsk={handleOpenAi} />
          </div>
        </div>

        <div className="container landing__body">
          <section aria-labelledby="solutions-heading" className="landing__section">
            <h2 id="solutions-heading" className="section-label">
              {t('landing.solutions')}
            </h2>
            <div className="landing__cards">
              {products.map((product, i) => (
                <ProductCard key={product.slug} product={product} index={i} isReturn={isReturnNav} />
              ))}
            </div>
          </section>

          <section className="cta" aria-labelledby="cta-heading">
            <div className="cta__text">
              <h2 id="cta-heading" className="cta__title">
                {t('cta.title')}
              </h2>
              <p className="cta__subtitle">{t('cta.subtitle')}</p>
            </div>

            <div className="cta__actions">
              <button
                id="btn-request-demo"
                type="button"
                className="btn btn--primary cta__btn"
                onClick={handleOpenDemo}
              >
                <span>{t('actions.requestDemo')}</span>
                <ActionArrow direction="internal" />
              </button>

              <a className="btn btn--secondary cta__btn" href={`mailto:${t('footer.email')}`}>
                <span>{t('actions.contact')}</span>
                <ActionArrow direction="external" />
              </a>
            </div>
          </section>
        </div>
      </main>

      <Footer />

      <RequestDemoModal isOpen={isDemoModalOpen} onClose={() => setIsDemoModalOpen(false)} />
      <CaspelAIModal isOpen={isAiModalOpen} onClose={closeAi} initialQuestion={seedQuestion} />
    </div>
  );
};
