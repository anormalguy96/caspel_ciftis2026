import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { ArrowLeft, Calendar, AlertTriangle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Header } from '../components/Header';
import { PdfViewer } from '../components/PdfViewer';
import { parsePageParam } from '../utils/citationLink';
import { RequestDemoModal } from '../components/RequestDemoModal';
import { CaspelAIModal } from '../components/CaspelAIModal';
import { useProduct } from '../config/products';
import { usePresentationManifest } from '../hooks/usePresentationManifest';
import { DownloadPresentationButton } from '../components/DownloadPresentationButton';
import { downloadPresentation } from '../services/presentations';
import { trackAnalyticsEvent } from '../services/analytics';
import { transitionNavigate } from '../utils/transitionNavigate';
import caspelIcon from '../assets/caspel-icon.svg';

/**
 * The canonical presentation experience.
 *
 * A visitor who taps a product at a stand wants the document, not a summary of
 * the document with a button that opens it. The deck mounts here directly, and
 * the intermediate step is gone.
 *
 * The four states below are deliberately distinct, because conflating them
 * lies to the visitor. A manifest still loading is not an absent deck. A
 * server that cannot be reached is not an unpublished deck — telling someone
 * "not yet published" when the truth is "our server is down" is a false
 * statement about CASPEL's materials. And a deck the registry has not approved
 * is genuinely unavailable, not broken.
 */
export const ProductPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * A page requested by an assistant citation deep link.
   *
   * Parsed defensively: anything that is not a small positive integer becomes
   * null and the viewer opens normally, rather than throwing or scrolling to
   * somewhere arbitrary. The viewer clamps it again against the real page
   * count, which is the only authority on how long the document is.
   */
  const citedPage = React.useMemo(
    () => parsePageParam(new URLSearchParams(location.search).get('page')),
    [location.search]
  );
  const { t } = useTranslation();

  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);

  const { getEntry, status, retry } = usePresentationManifest();
  const product = useProduct(slug);

  const validSlug = product?.slug ?? null;
  const entry = validSlug ? getEntry(validSlug) : undefined;
  const isAvailable = entry?.available ?? false;

  // Exactly one PRODUCT_VIEW per product entered, and exactly one
  // PRESENTATION_VIEW per viewer actually mounted. Refs rather than effect
  // dependencies because a manifest retry, a language change and StrictMode's
  // double-invoked effects would each otherwise count again.
  const countedProductView = useRef<string | null>(null);
  const countedPresentationView = useRef<string | null>(null);

  useEffect(() => {
    if (!validSlug || countedProductView.current === validSlug) return;
    countedProductView.current = validSlug;
    trackAnalyticsEvent('PRODUCT_VIEW', validSlug);
  }, [validSlug]);

  useEffect(() => {
    if (!validSlug || !isAvailable) return;
    if (countedPresentationView.current === validSlug) return;
    countedPresentationView.current = validSlug;
    trackAnalyticsEvent('PRESENTATION_VIEW', validSlug);
  }, [validSlug, isAvailable]);

  /**
   * Records the download. The transfer itself is started by the button, which
   * owns its own states; this only counts it. The slug is an identifier, not
   * visitor content, so nothing personal is recorded.
   */
  const handleDownloadTracked = useCallback(() => {
    if (!validSlug) return;
    trackAnalyticsEvent('PRESENTATION_DOWNLOAD', validSlug);
  }, [validSlug]);

  /** Used by the viewer's error fallback, which offers a download escape. */
  const handleDownload = useCallback(() => {
    if (!validSlug || !product || !isAvailable) return;
    trackAnalyticsEvent('PRESENTATION_DOWNLOAD', validSlug);
    downloadPresentation(validSlug, product.downloadFilename);
  }, [validSlug, product, isAvailable]);

  /**
   * Natural Back when there is somewhere to go back to, the landing page when
   * there is not. A deep link scanned from a printed code has no in-app
   * history, and history.back() there leaves the site entirely.
   */
  const goBack = useCallback(() => {
    const hasAppHistory = (location.key ?? 'default') !== 'default';
    if (hasAppHistory) transitionNavigate(navigate, -1);
    else transitionNavigate(navigate, '/');
  }, [navigate, location.key]);

  if (!product || !validSlug) {
    return <Navigate to="/not-found" replace />;
  }

  return (
    <div className="page page--viewer">
      <Header />

      {/* Sticky, never fixed over the document: it yields to the page instead
          of covering the first lines of a slide. */}
      <div className="viewer-bar">
        <div className="container viewer-bar__inner">
          <button type="button" className="btn btn--ghost viewer-bar__back" onClick={goBack}>
            <ArrowLeft size={18} aria-hidden="true" />
            <span>{t('actions.back')}</span>
          </button>

          <div className="viewer-bar__identity u-page-enter">
            <span
              className="viewer-bar__name"
              style={{ viewTransitionName: `product-title-${product.slug}` } as React.CSSProperties}
            >
              {product.name}
            </span>
            <span
              className="viewer-bar__descriptor"
              style={{ viewTransitionName: `product-desc-${product.slug}` } as React.CSSProperties}
            >
              {product.descriptor}
            </span>
          </div>

          <div className="viewer-bar__meta" aria-live="polite">
            {status === 'loading' && <span>{t('presentation.loadingStatus')}</span>}
            {status === 'ready' && pageCount !== null && (
              <span>{t('presentation.pageCount', { count: pageCount })}</span>
            )}
          </div>

          <div className="viewer-bar__actions">
            <button
              type="button"
              className="btn btn--ghost viewer-bar__ai"
              onClick={() => {
                trackAnalyticsEvent('AI_OPEN', product.slug);
                setIsAiModalOpen(true);
              }}
            >
              <img src={caspelIcon} alt="" aria-hidden="true" className="viewer-bar__ai-icon" />
              <span>{t('actions.askAi')}</span>
            </button>

            {isAvailable && (
              <DownloadPresentationButton
                slug={validSlug}
                filename={product.downloadFilename}
                onDownloaded={handleDownloadTracked}
              />
            )}
          </div>
        </div>
      </div>

      <main className="viewer-main u-page-enter" style={{ '--i': 1 } as React.CSSProperties}>
        {status === 'loading' && (
          <div className="viewer-status">
            <p className="viewer-status__text" role="status">
              {t('presentation.loadingStatus')}
            </p>
            <div className="u-skeleton viewer-status__block" aria-hidden="true" />
          </div>
        )}

        {status === 'error' && (
          <div className="viewer-status" role="alert">
            <span className="viewer-status__icon" aria-hidden="true">
              <AlertTriangle size={22} />
            </span>
            <h1 className="viewer-status__title">{t('presentation.errorTitle')}</h1>
            <p className="viewer-status__text">{t('presentation.errorText')}</p>
            <button type="button" className="btn btn--secondary" onClick={retry}>
              <RotateCw size={15} aria-hidden="true" />
              <span>{t('actions.retry')}</span>
            </button>
          </div>
        )}

        {status === 'ready' && isAvailable && (
          <PdfViewer
            focusPage={citedPage}
            url={product.presentationUrl}
            onDownload={handleDownload}
            onPageCountChange={setPageCount}
          />
        )}

        {status === 'ready' && !isAvailable && (
          <div className="viewer-status">
            <h1 className="viewer-status__title">{t('presentation.unavailableTitle')}</h1>
            <p className="viewer-status__text">{t('presentation.unavailableText')}</p>
            <p className="viewer-status__summary">{product.description}</p>

            <div className="viewer-status__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  trackAnalyticsEvent('DEMO_OPEN', product.slug);
                  setIsDemoModalOpen(true);
                }}
              >
                <Calendar size={18} aria-hidden="true" />
                <span>{t('actions.requestDemo')}</span>
              </button>
            </div>
          </div>
        )}
      </main>

      <RequestDemoModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
        defaultProduct={product.slug}
      />
      <CaspelAIModal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} />
    </div>
  );
};
