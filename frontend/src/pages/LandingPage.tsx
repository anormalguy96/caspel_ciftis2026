import React, { useState, useEffect } from 'react';
import { Calendar, ArrowRight, Mail } from 'lucide-react';
import { Header } from '../components/Header';
import { Hero } from '../components/Hero';
import { ProductCard } from '../components/ProductCard';
import { RequestDemoModal } from '../components/RequestDemoModal';
import { CaspelAIModal } from '../components/CaspelAIModal';
import { Footer } from '../components/Footer';
import { PRODUCT_LIST } from '../config/products';
import { trackAnalyticsEvent } from '../services/analytics';
import en from '../locales/en.json';
import caspelIcon from '../assets/caspel-icon.svg';

export const LandingPage: React.FC = () => {
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);

  useEffect(() => {
    trackAnalyticsEvent('LANDING_OPEN');
  }, []);

  const handleOpenDemo = () => {
    trackAnalyticsEvent('DEMO_OPEN');
    setIsDemoModalOpen(true);
  };

  const handleOpenAi = () => {
    trackAnalyticsEvent('AI_OPEN');
    setIsAiModalOpen(true);
  };

  return (
    <div className="page">
      <Header />
      <Hero />

      <main className="container landing">
        <section aria-labelledby="solutions-heading" className="landing__section">
          <h2 id="solutions-heading" className="section-label">
            Solutions
          </h2>
          <div className="landing__cards">
            {PRODUCT_LIST.map((product, i) => (
              <ProductCard key={product.slug} product={product} index={i} />
            ))}
          </div>
        </section>

        <section className="ai-banner" aria-labelledby="ai-banner-heading">
          <span className="ai-banner__icon" aria-hidden="true">
            <img src={caspelIcon} alt="" className="ai-banner__caspel-icon" />
          </span>

          <div className="ai-banner__text">
            <h2 id="ai-banner-heading" className="ai-banner__title">
              {en.ai.title}
            </h2>
            <p className="ai-banner__subtitle">
              Answers drawn only from the presentations on this page, with the slide cited.
            </p>
          </div>

          <button
            id="btn-ask-ai"
            type="button"
            className="btn btn--secondary ai-banner__btn"
            onClick={handleOpenAi}
          >
            <span>{en.actions.askAi}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </section>

        <section className="cta" aria-labelledby="cta-heading">
          <div className="cta__text">
            <h2 id="cta-heading" className="cta__title">
              Schedule a dedicated demo
            </h2>
            <p className="cta__subtitle">
              Meet our engineering specialists at the CASPEL stand, or send us a note and we will
              come back to you.
            </p>
          </div>

          <div className="cta__actions">
            <button
              id="btn-request-demo"
              type="button"
              className="btn btn--primary cta__btn"
              onClick={handleOpenDemo}
            >
              <Calendar size={18} aria-hidden="true" />
              <span>{en.actions.requestDemo}</span>
            </button>

            <a className="btn btn--onDark cta__btn" href={`mailto:${en.footer.email}`}>
              <Mail size={18} aria-hidden="true" />
              <span>{en.actions.contact}</span>
            </a>
          </div>
        </section>
      </main>

      <Footer />

      <RequestDemoModal isOpen={isDemoModalOpen} onClose={() => setIsDemoModalOpen(false)} />
      <CaspelAIModal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} />
    </div>
  );
};
