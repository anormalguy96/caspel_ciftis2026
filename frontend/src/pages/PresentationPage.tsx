import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FileText } from 'lucide-react';
import { Header } from '../components/Header';
import { PRODUCTS } from '../config/products';
import { ProductSlug } from '../types';
import { trackAnalyticsEvent } from '../services/analytics';

export const PresentationPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const productKey = (slug || 'caspel') as ProductSlug;
  const product = PRODUCTS[productKey] || PRODUCTS.caspel;

  useEffect(() => {
    trackAnalyticsEvent('PRESENTATION_VIEW', product.slug);
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

      <div style={styles.topControlBar}>
        <div className="container" style={styles.controlBarInner}>
          <button
            onClick={() => navigate(`/ciftis/product/${product.slug}`)}
            style={styles.backBtn}
          >
            <ArrowLeft size={16} />
            <span>{product.name}</span>
          </button>

          <button onClick={handleDownload} style={styles.downloadBtn}>
            <Download size={16} />
            <span>Download</span>
          </button>
        </div>
      </div>

      <main className="container" style={styles.viewerContainer}>
        <div style={styles.viewerCard}>
          <div style={styles.viewerHeader}>
            <div style={styles.docInfo}>
              <FileText size={18} color="var(--color-accent)" />
              <span style={styles.docTitle}>{product.downloadFilename}</span>
            </div>
            <span style={styles.viewerBadge}>PDF Viewer</span>
          </div>

          <div style={styles.pdfFrameContainer}>
            <iframe
              src={`${product.presentationUrl}#toolbar=0&navpanes=0`}
              title={product.name}
              style={styles.pdfIframe}
            />
          </div>
        </div>
      </main>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  pageWrapper: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: 'var(--color-bg)',
  },
  topControlBar: {
    padding: '12px 0',
    backgroundColor: 'var(--color-surface)',
    borderBottom: '1px solid var(--color-border)',
  },
  controlBarInner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--color-surface-elevated)',
    color: 'var(--color-text)',
    fontSize: '13px',
    fontWeight: '600',
  },
  downloadBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-accent-gradient)',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: '600',
  },
  viewerContainer: {
    flex: 1,
    padding: '20px 16px 40px 16px',
    display: 'flex',
    flexDirection: 'column',
  },
  viewerCard: {
    flex: 1,
    minHeight: '550px',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  viewerHeader: {
    padding: '12px 16px',
    backgroundColor: 'var(--color-surface-elevated)',
    borderBottom: '1px solid var(--color-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  docInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  docTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--color-text)',
  },
  viewerBadge: {
    fontSize: '11px',
    padding: '3px 8px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(0, 194, 255, 0.15)',
    color: 'var(--color-accent)',
    fontWeight: '600',
  },
  pdfFrameContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: '500px',
  },
  pdfIframe: {
    width: '100%',
    height: '100%',
    minHeight: '500px',
    border: 'none',
  },
};
