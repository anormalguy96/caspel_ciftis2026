import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import {
  ArrowLeft,
  Eye,
  Download,
  Calendar,
  MessageSquare,
  FileText,
  AlertTriangle,
  RotateCw,
} from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { RequestDemoModal } from '../components/RequestDemoModal';
import { CaspelAIModal } from '../components/CaspelAIModal';
import { PRODUCTS, isProductSlug } from '../config/products';
import { usePresentationManifest } from '../hooks/usePresentationManifest';
import { downloadPresentation } from '../services/presentations';
import { trackAnalyticsEvent } from '../services/analytics';
import en from '../locales/en.json';

export const ProductPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const { getEntry, status, retry } = usePresentationManifest();

  const validSlug = isProductSlug(slug) ? slug : null;
  const product = validSlug ? PRODUCTS[validSlug] : null;
  const entry = validSlug ? getEntry(validSlug) : undefined;
  const isAvailable = entry?.available ?? false;

  useEffect(() => {
    if (validSlug) trackAnalyticsEvent('PRODUCT_VIEW', validSlug);
  }, [validSlug]);

  const handleDownload = useCallback(() => {
    if (!validSlug || !product || !isAvailable) return;
    trackAnalyticsEvent('PRESENTATION_DOWNLOAD', validSlug);
    downloadPresentation(validSlug, product.downloadFilename);
  }, [validSlug, product, isAvailable]);

  if (!validSlug || !product) {
    return <Navigate to="/ciftis/not-found" replace />;
  }

  return (
    <div className="page">
      <Header />

      <main className="container page__main">
        <div className="product__back">
          <button
            type="button"
            className="btn btn--ghost product__back-btn"
            onClick={() => navigate('/ciftis')}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span>{en.actions.back}</span>
          </button>
        </div>

        <div className="product__layout">
          <div className="product__primary">
            <section className="product__header u-enter">
              <h1 className="product__title">{product.name}</h1>
              <p className="product__descriptor">{product.descriptor}</p>
            </section>

            <section className="product__overview u-enter" style={{ ['--i' as string]: 1 }}>
              <p className="product__summary">{product.description}</p>
            </section>
          </div>

          <aside className="product__aside">
            <section className="product__preview u-enter" style={{ ['--i' as string]: 1 }}>
              <div className="product__preview-doc">
                <FileText size={26} aria-hidden="true" className="product__preview-icon" />
                <div className="product__preview-meta">
                  <span className="product__preview-file">{product.downloadFilename}</span>
                  {entry?.page_count ? (
                    <span className="product__preview-pages">{entry.page_count} pages</span>
                  ) : null}
                </div>
              </div>

              <div className="product__actions">
                {status === 'loading' && (
                  <div className="u-skeleton product__actions-skeleton" aria-hidden="true" />
                )}

                {/* A server that cannot be reached is not a deck that does not
                    exist. Saying "not yet published" here would be a false
                    statement about CASPEL's materials. */}
                {status === 'error' && (
                  <div className="state-notice state-notice--error" role="alert">
                    <span className="state-notice__icon" aria-hidden="true">
                      <AlertTriangle size={16} />
                    </span>
                    <div className="state-notice__body">
                      <p className="state-notice__title">{en.presentation.errorTitle}</p>
                      <p className="state-notice__text">{en.presentation.errorText}</p>
                      <button type="button" className="btn btn--secondary" onClick={retry}>
                        <RotateCw size={15} aria-hidden="true" />
                        <span>{en.actions.retry}</span>
                      </button>
                    </div>
                  </div>
                )}

                {status === 'ready' && isAvailable && (
                  <>
                    <Link
                      to={`/ciftis/presentation/${product.slug}`}
                      className="btn btn--primary btn--block"
                      onClick={() => trackAnalyticsEvent('PRESENTATION_VIEW', product.slug)}
                    >
                      <Eye size={18} aria-hidden="true" />
                      <span>{en.actions.viewPresentation}</span>
                    </Link>

                    <button
                      type="button"
                      className="btn btn--secondary btn--block"
                      onClick={handleDownload}
                    >
                      <Download size={18} aria-hidden="true" />
                      <span>{en.actions.downloadPresentation}</span>
                    </button>
                  </>
                )}

                {status === 'ready' && !isAvailable && (
                  <div className="state-notice">
                    <div className="state-notice__body">
                      <p className="state-notice__title">{en.presentation.unavailableTitle}</p>
                      <p className="state-notice__text">{en.presentation.unavailableText}</p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="product__secondary u-enter" style={{ ['--i' as string]: 2 }}>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  trackAnalyticsEvent('DEMO_OPEN', product.slug);
                  setIsDemoModalOpen(true);
                }}
              >
                <Calendar size={18} aria-hidden="true" />
                <span>{en.actions.requestDemo}</span>
              </button>

              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  trackAnalyticsEvent('AI_OPEN', product.slug);
                  setIsAiModalOpen(true);
                }}
              >
                <MessageSquare size={18} aria-hidden="true" />
                <span>{en.actions.askAi}</span>
              </button>
            </section>
          </aside>
        </div>
      </main>

      <Footer />

      <RequestDemoModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
        defaultProduct={product.slug}
      />
      <CaspelAIModal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} />
    </div>
  );
};
