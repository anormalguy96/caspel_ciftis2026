import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Eye, Download, Calendar, Sparkles, FileText } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { RequestDemoModal } from '../components/RequestDemoModal';
import { CaspelAIModal } from '../components/CaspelAIModal';
import { PRODUCTS } from '../config/products';
import { ProductSlug } from '../types';
import { trackAnalyticsEvent } from '../services/analytics';
import en from '../locales/en.json';

export const ProductPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);

  const productKey = (slug || 'caspel') as ProductSlug;
  const product = PRODUCTS[productKey] || PRODUCTS.caspel;

  useEffect(() => {
    trackAnalyticsEvent('PRODUCT_VIEW', product.slug);
  }, [product.slug]);

  const handleDownload = () => {
    trackAnalyticsEvent('PRESENTATION_DOWNLOAD', product.slug);
    const link = document.createElement('a');
    link.href = product.presentationUrl;
    link.download = product.downloadFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={styles.pageWrapper}>
      <Header />

      <main className="container" style={styles.mainContent}>
        {/* Back navigation */}
        <div style={styles.backNav}>
          <button onClick={() => navigate('/ciftis')} style={styles.backBtn}>
            <ArrowLeft size={16} />
            <span>{en.actions.back}</span>
          </button>
        </div>

        {/* Product Header */}
        <section style={styles.productHeader}>
          <div style={{ ...styles.badge, borderColor: product.accentColor }}>
            <span style={{ ...styles.badgeText, color: product.accentColor }}>
              {product.badge}
            </span>
          </div>
          <h1 style={styles.productTitle}>{product.name}</h1>
          <p style={styles.productDescriptor}>{product.descriptor}</p>
        </section>

        {/* Overview Box */}
        <section style={styles.overviewBox}>
          <p style={styles.summaryText}>{product.description}</p>
        </section>

        {/* Presentation Preview Card */}
        <section style={styles.previewCard}>
          <div style={styles.previewIllustration}>
            <FileText size={48} color="var(--color-accent)" />
            <span style={styles.previewLabel}>{product.downloadFilename}</span>
          </div>

          <div style={styles.actionButtons}>
            <Link
              to={`/ciftis/presentation/${product.slug}`}
              onClick={() => trackAnalyticsEvent('PRESENTATION_VIEW', product.slug)}
              style={styles.primaryActionBtn}
            >
              <Eye size={18} />
              <span>{en.actions.viewPresentation}</span>
            </Link>

            <button onClick={handleDownload} style={styles.secondaryActionBtn}>
              <Download size={18} />
              <span>{en.actions.downloadPresentation}</span>
            </button>
          </div>
        </section>

        {/* Action Row: Demo & AI */}
        <section style={styles.bottomActions}>
          <button
            onClick={() => {
              trackAnalyticsEvent('DEMO_OPEN', product.slug);
              setIsDemoModalOpen(true);
            }}
            style={styles.demoActionBtn}
          >
            <Calendar size={18} />
            <span>{en.actions.requestDemo}</span>
          </button>

          <button
            onClick={() => {
              trackAnalyticsEvent('AI_OPEN', product.slug);
              setIsAiModalOpen(true);
            }}
            style={styles.aiActionBtn}
          >
            <Sparkles size={18} color="var(--color-accent)" />
            <span>{en.actions.askAi}</span>
          </button>
        </section>
      </main>

      <Footer />

      {/* Modals */}
      <RequestDemoModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
        defaultProduct={product.slug}
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
    paddingTop: '20px',
    paddingBottom: '40px',
  },
  backNav: {
    marginBottom: '20px',
  },
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 14px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-secondary)',
    fontSize: '13px',
    fontWeight: '600',
  },
  productHeader: {
    marginBottom: '20px',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '34px',
    height: '34px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid',
    marginBottom: '12px',
  },
  badgeText: {
    fontSize: '14px',
    fontWeight: '700',
  },
  productTitle: {
    fontSize: '28px',
    fontWeight: '800',
    color: 'var(--color-text)',
    marginBottom: '4px',
  },
  productDescriptor: {
    fontSize: '15px',
    color: 'var(--color-text-secondary)',
    fontWeight: '500',
  },
  overviewBox: {
    padding: '18px 20px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface-card)',
    border: '1px solid var(--color-border)',
    marginBottom: '24px',
  },
  summaryText: {
    fontSize: '14px',
    lineHeight: 1.6,
    color: 'var(--color-text)',
  },
  previewCard: {
    padding: '28px 20px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    marginBottom: '24px',
    textAlign: 'center',
  },
  previewIllustration: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '24px',
  },
  previewLabel: {
    fontSize: '13px',
    color: 'var(--color-text-secondary)',
    fontWeight: '600',
  },
  actionButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  primaryActionBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-accent-gradient)',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: '700',
    boxShadow: '0 4px 15px rgba(0, 102, 204, 0.35)',
  },
  secondaryActionBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface-elevated)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    fontSize: '15px',
    fontWeight: '600',
  },
  bottomActions: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  demoActionBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface-card)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    fontSize: '14px',
    fontWeight: '600',
  },
  aiActionBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface-card)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    fontSize: '14px',
    fontWeight: '600',
  },
};
