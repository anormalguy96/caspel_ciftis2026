import React, { useState, useEffect } from 'react';
import { Sparkles, Calendar, ArrowRight } from 'lucide-react';
import { Header } from '../components/Header';
import { Hero } from '../components/Hero';
import { ProductCard } from '../components/ProductCard';
import { RequestDemoModal } from '../components/RequestDemoModal';
import { CaspelAIModal } from '../components/CaspelAIModal';
import { Footer } from '../components/Footer';
import { PRODUCT_LIST } from '../config/products';
import { trackAnalyticsEvent } from '../services/analytics';
import en from '../locales/en.json';

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
    <div style={styles.pageWrapper}>
      <Header />
      <Hero />

      <main className="container" style={styles.mainContent}>
        {/* Four Product Cards */}
        <section style={styles.cardsSection} aria-label="Solutions">
          {PRODUCT_LIST.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </section>

        {/* AI Assistant CTA Banner */}
        <section style={styles.aiBanner}>
          <div style={styles.aiBannerLeft}>
            <div style={styles.aiIconBadge}>
              <Sparkles size={20} color="#00c2ff" />
            </div>
            <div>
              <h3 style={styles.aiBannerTitle}>{en.ai.title}</h3>
              <p style={styles.aiBannerText}>Have questions about CASPEL or our solutions?</p>
            </div>
          </div>
          <button onClick={handleOpenAi} style={styles.aiBannerBtn}>
            <span>{en.actions.askAi}</span>
            <ArrowRight size={16} />
          </button>
        </section>

        {/* Request Demo Section */}
        <section style={styles.demoSection}>
          <div style={styles.demoBox}>
            <h3 style={styles.demoTitle}>Interested in our enterprise solutions?</h3>
            <p style={styles.demoSubtitle}>Schedule a dedicated demonstration with our engineering specialists.</p>
            <button onClick={handleOpenDemo} style={styles.demoBtn}>
              <Calendar size={18} />
              <span>{en.actions.requestDemo}</span>
            </button>
          </div>
        </section>
      </main>

      <Footer />

      {/* Modals */}
      <RequestDemoModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
      />
      <CaspelAIModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
      />
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  pageWrapper: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
  },
  mainContent: {
    paddingBottom: '40px',
  },
  cardsSection: {
    marginBottom: '24px',
  },
  aiBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '16px',
    padding: '18px 20px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'rgba(0, 102, 204, 0.12)',
    border: '1px solid rgba(0, 194, 255, 0.3)',
    marginBottom: '24px',
  },
  aiBannerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  aiIconBadge: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: 'rgba(0, 194, 255, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  aiBannerTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: 'var(--color-text)',
  },
  aiBannerText: {
    fontSize: '13px',
    color: 'var(--color-text-secondary)',
  },
  aiBannerBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 18px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-accent)',
    fontSize: '14px',
    fontWeight: '600',
  },
  demoSection: {
    marginBottom: '32px',
  },
  demoBox: {
    padding: '24px 20px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface-card)',
    border: '1px solid var(--color-border)',
    textAlign: 'center',
  },
  demoTitle: {
    fontSize: '18px',
    fontWeight: '700',
    color: 'var(--color-text)',
    marginBottom: '6px',
  },
  demoSubtitle: {
    fontSize: '13px',
    color: 'var(--color-text-secondary)',
    marginBottom: '18px',
  },
  demoBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px 28px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-accent-gradient)',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '700',
    boxShadow: '0 4px 15px rgba(0, 102, 204, 0.3)',
  },
};
