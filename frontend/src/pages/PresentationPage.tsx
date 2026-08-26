import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { ArrowLeft, Download, AlertTriangle, RotateCw } from 'lucide-react';
import { Header } from '../components/Header';
import { PdfViewer } from '../components/PdfViewer';
import { PRODUCTS, isProductSlug } from '../config/products';
import { usePresentationManifest } from '../hooks/usePresentationManifest';
import { trackAnalyticsEvent } from '../services/analytics';
import { downloadPresentation } from '../services/presentations';
import en from '../locales/en.json';

export const PresentationPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { getEntry, status, retry } = usePresentationManifest();
  const [pageCount, setPageCount] = useState<number | null>(null);

  // Every hook runs unconditionally; the 404 redirect happens after them.
  const validSlug = isProductSlug(slug) ? slug : null;
  const product = validSlug ? PRODUCTS[validSlug] : null;
  const isAvailable = validSlug ? getEntry(validSlug)?.available ?? false : false;

  useEffect(() => {
    if (validSlug && isAvailable) trackAnalyticsEvent('PRESENTATION_VIEW', validSlug);
  }, [validSlug, isAvailable]);

  const handleDownload = useCallback(() => {
    if (!validSlug || !product || !isAvailable) return;
    trackAnalyticsEvent('PRESENTATION_DOWNLOAD', validSlug);
    downloadPresentation(validSlug, product.downloadFilename);
  }, [validSlug, product, isAvailable]);

  // An unrecognised slug is a real 404, not a silent redirect to Corporate.
  if (!validSlug || !product) {
    return <Navigate to="/ciftis/not-found" replace />;
  }

  return (
    <div className="page page--viewer">
      <Header />

      <div className="viewer-bar">
        <div className="container viewer-bar__inner">
          <button
            type="button"
            className="btn btn--ghost viewer-bar__back"
            onClick={() => navigate(`/ciftis/product/${product.slug}`)}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span>{product.name}</span>
          </button>

          <button
            type="button"
            className="btn btn--primary viewer-bar__download"
            onClick={handleDownload}
            disabled={!isAvailable}
          >
            <Download size={16} aria-hidden="true" />
            <span>Download</span>
          </button>
        </div>
      </div>

      <main className="container viewer-main">
        {status === 'loading' && (
          <div className="viewer-status">
            <div className="u-skeleton viewer-status__block" />
          </div>
        )}

        {/* A manifest that could not be fetched is a temporary server problem.
            Presenting it as "not yet published" would tell a visitor CASPEL has
            no such deck, which is a different and untrue statement. */}
        {status === 'error' && (
          <div className="viewer-status viewer-status--empty" role="alert">
            <span className="viewer-status__icon" aria-hidden="true">
              <AlertTriangle size={26} />
            </span>
            <h1 className="viewer-status__title">{en.presentation.errorTitle}</h1>
            <p className="viewer-status__text">{en.presentation.errorText}</p>
            <div className="viewer-status__actions">
              <button type="button" className="btn btn--primary" onClick={retry}>
                <RotateCw size={16} aria-hidden="true" />
                <span>{en.actions.retry}</span>
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => navigate(`/ciftis/product/${product.slug}`)}
              >
                Back to {product.name}
              </button>
            </div>
          </div>
        )}

        {status === 'ready' && !isAvailable && (
          <div className="viewer-status viewer-status--empty">
            <h1 className="viewer-status__title">{product.name}</h1>
            <p className="viewer-status__text">{en.presentation.unavailableText}</p>
            <div className="viewer-status__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => navigate(`/ciftis/product/${product.slug}`)}
              >
                Back to {product.name}
              </button>
            </div>
          </div>
        )}

        {isAvailable && (
          <>
            <div className="viewer-meta">
              <span className="viewer-meta__file">{product.downloadFilename}</span>
              {pageCount !== null && (
                <span className="viewer-meta__pages">{pageCount} pages</span>
              )}
            </div>
            <PdfViewer
              url={product.presentationUrl}
              onDownload={handleDownload}
              onPageCountChange={setPageCount}
            />
          </>
        )}
      </main>
    </div>
  );
};
