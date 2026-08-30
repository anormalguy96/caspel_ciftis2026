import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCw, ExternalLink, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Worker resolved through Vite so it is bundled and served from our own origin.
// A CDN workerSrc would break behind the GFW (document.md §24).
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

/**
 * Renders each page to a canvas only once it approaches the viewport.
 *
 * A plain <iframe src="…pdf"> delegates to the browser's built-in viewer, which
 * iOS Safari does not provide inside a frame — visitors arriving by QR code on an
 * iPhone see a blank panel or a single static page. Rendering ourselves gives the
 * same scrolling, zooming experience on every device (document.md §12).
 */

const MAX_RENDER_SCALE = 3;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.5;
// Start fetching a page's bitmap before it scrolls into view.
const PRERENDER_MARGIN_PX = 800;

type LoadState = 'loading' | 'ready' | 'error';

interface PdfViewerProps {
  url: string;
  /** Shown in the error state so a visitor is never left at a dead end. */
  onDownload?: () => void;
  onPageCountChange?: (count: number) => void;
  /**
   * Page to bring into view once the document has loaded, from an assistant
   * citation deep link.
   *
   * Already parsed and range-checked by the caller; it is clamped again here
   * against the document's own page count, because the registry and the file
   * are two different sources of truth and only the file can be final.
   *
   * Applied once per document load, not on every render: re-scrolling after
   * the visitor has started reading would take the page away from them.
   */
  focusPage?: number | null;
}

interface PageCanvasProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  containerWidth: number;
  initialAspect: number;
  scrollRoot: HTMLElement | null;
  zoom: number;
}

const PageCanvas: React.FC<PageCanvasProps> = ({
  doc,
  pageNumber,
  containerWidth,
  initialAspect,
  scrollRoot,
  zoom,
}) => {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [rendered, setRendered] = useState(false);
  // Reserve the correct height before rendering so the scrollbar doesn't jump.
  const [aspect, setAspect] = useState(initialAspect);

  useEffect(() => {
    const node = holderRef.current;
    if (!node) return;

    const renderObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setShouldRender(true);
        }
      },
      { root: scrollRoot, rootMargin: `${PRERENDER_MARGIN_PX}px 0px`, threshold: 0 }
    );

    renderObserver.observe(node);
    return () => renderObserver.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!shouldRender || !containerWidth) return;

    let cancelled = false;

    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const base = page.getViewport({ scale: 1 });
        setAspect(base.height / base.width);

        const cssScale = (containerWidth / base.width) * zoom;
        // Cap the device-pixel multiplier: a 3x DPR phone at 3x zoom would
        // otherwise allocate a canvas large enough to be discarded by iOS.
        const renderScale = Math.min(
          cssScale * (window.devicePixelRatio || 1),
          cssScale * MAX_RENDER_SCALE
        );

        const viewport = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        renderTaskRef.current?.cancel();
        const task = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;

        await task.promise;
        if (!cancelled) setRendered(true);
      } catch (err) {
        // A cancelled render is expected while zooming or scrolling fast.
        if (!(err instanceof Error) || err.name !== 'RenderingCancelledException') {
          console.error(`Failed to render page ${pageNumber}`, err);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [doc, pageNumber, containerWidth, zoom, shouldRender]);

  return (
    <div
      ref={holderRef}
      className="pdf-page"
      data-page={pageNumber}
      style={{
        width: `${zoom * 100}%`,
        ...(!rendered ? { aspectRatio: `${1 / aspect}` } : {}),
      }}
    >
      {!rendered && <div className="pdf-page__skeleton u-skeleton" aria-hidden="true" />}
      <canvas
        ref={canvasRef}
        className="pdf-page__canvas"
        aria-label={`Page ${pageNumber}`}
        style={{ opacity: rendered ? 1 : 0 }}
      />
    </div>
  );
};

export const PdfViewer: React.FC<PdfViewerProps> = ({
  url,
  onDownload,
  onPageCountChange,
  focusPage = null,
}) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [initialAspect, setInitialAspect] = useState<number | null>(null);
  // Bumping this re-runs the load effect, so Retry genuinely refetches the
  // document instead of only repainting the error panel.
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setProgress(0);
    setDoc(null);
    setCurrentPage(1);
    setZoom(1);
    setInitialAspect(null);

    // One worker per load, torn down with it.
    //
    // Setting GlobalWorkerOptions.workerPort once at module scope shares a
    // single port across every document, and task.destroy() terminates that
    // port — so the first Retry, or simply opening a second deck, would hand
    // pdf.js a dead worker and fail permanently. Creating the worker here is
    // what makes Retry actually work; destroying it in the cleanup below is
    // what stops each attempt leaking a Web Worker on a visitor's phone.
    const worker = new pdfjsLib.PDFWorker(
      // pdfjs-dist's generated constructor signature types `port` as
      // `null | undefined`, while its own PDFWorkerParameters JSDoc and the
      // runtime both accept a Worker. The cast works around that upstream
      // typing bug and nothing else.
      { port: new PdfWorker() } as unknown as ConstructorParameters<typeof pdfjsLib.PDFWorker>[0]
    );
    const task = pdfjsLib.getDocument({
      url,
      worker,
      // Fetch byte ranges on demand instead of the whole file up front. The
      // corporate deck is ~24 MB; over exhibition Wi-Fi only the pages a
      // visitor actually opens should cross the network (document.md §23).
      disableAutoFetch: true,
      disableStream: false,
    });

    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (total > 0 && !cancelled) setProgress(Math.min(100, (loaded / total) * 100));
    };

    task.promise
      .then(async (loaded) => {
        if (cancelled) {
          loaded.destroy().catch(() => {});
          return;
        }
        // Reserve real page geometry before mounting the page list. Without
        // this, every zero-height placeholder intersects at the same point,
        // causing the full deck to render eagerly and the counter to jump to
        // the final page before the visitor scrolls.
        const firstPage = await loaded.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });
        if (cancelled) {
          loaded.destroy().catch(() => {});
          return;
        }
        setInitialAspect(firstViewport.height / firstViewport.width);
        setDoc(loaded);
        setState('ready');
        onPageCountChange?.(loaded.numPages);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load presentation', err);
          setState('error');
        }
      });

    return () => {
      cancelled = true;
      // Destroy the worker only after the task has let go of it, otherwise
      // pdf.js logs a teardown error. Without this the viewer leaks one Web
      // Worker per Retry and per deck opened.
      void task
        .destroy()
        .catch(() => {})
        .finally(() => worker.destroy());
    };
  }, [url, onPageCountChange, reloadKey]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const measure = () => setContainerWidth(node.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [state]);

  const changeZoom = (delta: number) =>
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z + delta).toFixed(2))));

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !doc) return;

    let frame = 0;
    const updateCurrentPage = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const marker = node.getBoundingClientRect().top + Math.min(80, node.clientHeight * 0.15);
        const pages = Array.from(node.querySelectorAll<HTMLElement>('.pdf-page'));
        const active = pages.find((page) => page.getBoundingClientRect().bottom > marker);
        const pageNumber = Number(active?.dataset.page);
        if (Number.isFinite(pageNumber) && pageNumber > 0) setCurrentPage(pageNumber);
      });
    };

    node.addEventListener('scroll', updateCurrentPage, { passive: true });
    const resizeObserver = new ResizeObserver(updateCurrentPage);
    node.querySelectorAll('.pdf-page').forEach((page) => resizeObserver.observe(page));
    updateCurrentPage();

    return () => {
      node.removeEventListener('scroll', updateCurrentPage);
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [doc, zoom]);

  const goToPage = (page: number) => {
    const target = scrollRef.current?.querySelector(`[data-page="${page}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const pageNumbers = useMemo(
    () => (doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : []),
    [doc]
  );

  /**
   * Bring a cited page into view once, after the document has loaded.
   *
   * Waiting for  matters: the page elements do not exist until the
   * document reports its page count, so scrolling earlier would find nothing
   * and silently do nothing. The highlight is a brief data attribute rather
   * than a persistent style, so the page is pointed at and then left alone.
   */
  useEffect(() => {
    if (!doc || !focusPage) return undefined;

    const target = Math.min(Math.max(1, Math.floor(focusPage)), doc.numPages);
    let highlightTimer: number | undefined;

    // One frame, so the page nodes are laid out before we measure them.
    const frame = requestAnimationFrame(() => {
      const node = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${target}"]`);
      if (!node) return;

      const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      node.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      setCurrentPage(target);

      node.dataset.cited = 'true';
      highlightTimer = window.setTimeout(() => {
        delete node.dataset.cited;
      }, 2200);
    });

    return () => {
      cancelAnimationFrame(frame);
      if (highlightTimer) window.clearTimeout(highlightTimer);
    };
    // Deliberately keyed on the document identity and the requested page only.
    // Adding zoom or currentPage here would yank the view back mid-read.
  }, [doc, focusPage]);

  if (state === 'error') {
    return (
      <div className="pdf-viewer__fallback" role="alert" data-testid="pdf-viewer-error">
        <h2 className="pdf-viewer__fallback-title">{t('presentation.viewerErrorTitle')}</h2>
        <p className="pdf-viewer__fallback-text">{t('presentation.viewerErrorText')}</p>
        <div className="pdf-viewer__fallback-actions">
          {/* Retry first: a dropped byte-range request over exhibition Wi-Fi is
              the most common cause here, and refetching usually fixes it. */}
          <button type="button" className="btn btn--primary" onClick={retry}>
            <RotateCw size={16} aria-hidden="true" />
            <span>{t('actions.retry')}</span>
          </button>
          <a className="btn btn--secondary" href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" />
            <span>{t('actions.openInNewTab')}</span>
          </a>
          {onDownload && (
            <button type="button" className="btn btn--secondary" onClick={onDownload}>
              <Download size={16} aria-hidden="true" />
              <span>{t('actions.downloadPresentation')}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer__toolbar">
        <span className="pdf-viewer__counter" aria-live="polite">
          {doc ? `${currentPage} / ${doc.numPages}` : 'Loading…'}
        </span>

        <div className="pdf-viewer__controls">
          <button
            type="button"
            className="pdf-viewer__ctrl"
            onClick={() => goToPage(Math.max(1, currentPage - 1))}
            disabled={!doc || currentPage <= 1}
            aria-label={t('pdf.previous')}
          >
            ‹
          </button>
          <button
            type="button"
            className="pdf-viewer__ctrl"
            onClick={() => goToPage(Math.min(doc?.numPages ?? 1, currentPage + 1))}
            disabled={!doc || currentPage >= (doc?.numPages ?? 1)}
            aria-label={t('pdf.next')}
          >
            ›
          </button>
          <span className="pdf-viewer__divider" aria-hidden="true" />
          <button
            type="button"
            className="pdf-viewer__ctrl"
            onClick={() => changeZoom(-ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            aria-label={t('pdf.zoomOut')}
          >
            −
          </button>
          <button
            type="button"
            className="pdf-viewer__ctrl"
            onClick={() => changeZoom(ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            aria-label={t('pdf.zoomIn')}
          >
            +
          </button>
        </div>
      </div>

      <div className="pdf-viewer__scroll" ref={scrollRef}>
        {state === 'loading' && (
          <div className="pdf-viewer__loading">
            <div className="pdf-viewer__progress">
              <div className="pdf-viewer__progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <p className="pdf-viewer__loading-text">{t('pdf.preparing')}</p>
          </div>
        )}

        {doc && initialAspect !== null &&
          pageNumbers.map((n) => (
            <PageCanvas
              key={n}
              doc={doc}
              pageNumber={n}
              containerWidth={containerWidth}
              initialAspect={initialAspect}
              scrollRoot={scrollRef.current}
              zoom={zoom}
            />
          ))}
      </div>
    </div>
  );
};
