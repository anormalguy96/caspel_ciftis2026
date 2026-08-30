import type { PDFDocumentProxy } from 'pdfjs-dist';

import { presentationStreamUrl } from './presentations';
import type { ProductSlug } from '../types';

/**
 * Renders a single presentation page into a canvas, for citation previews.
 *
 * Three things make this cheap enough to run several times inside one answer:
 *
 *   * PDF.js is imported dynamically, so the landing page never downloads it.
 *     A visitor who never opens the assistant never pays for the viewer.
 *   * Document loading tasks are shared per slug. Four citations from the same
 *     deck open one document, not four, and the range requests behind it are
 *     issued once.
 *   * Only the cited page is rendered, at a capped width and device pixel
 *     ratio, so a high-DPI phone does not allocate a full-resolution canvas
 *     for a 220px thumbnail.
 *
 * The same verified stream endpoint the viewer uses is the only source. There
 * is deliberately no new arbitrary-file endpoint: a preview must not be able to
 * reach a byte the viewer could not.
 */

interface ThumbnailRequest {
  slug: string;
  page: number;
  canvas: HTMLCanvasElement | null;
  width: number;
  maxDpr: number;
  signal?: AbortSignal;
}

interface CacheEntry {
  promise: Promise<PDFDocumentProxy>;
  /** How many callers still need this document. */
  refs: number;
}

const documentCache = new Map<string, CacheEntry>();

let pdfjsModule: typeof import('pdfjs-dist') | null = null;
let workerPort: Worker | null = null;

async function loadPdfjs() {
  if (!pdfjsModule) {
    pdfjsModule = await import('pdfjs-dist');
    // One worker for every thumbnail. Spawning one per citation would start
    // several threads to draw a handful of small images.
    const { default: PdfWorker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker');
    workerPort = new PdfWorker();
  }
  return pdfjsModule;
}

function acquireDocument(slug: string): Promise<PDFDocumentProxy> {
  const existing = documentCache.get(slug);
  if (existing) {
    existing.refs += 1;
    return existing.promise;
  }

  const promise = (async () => {
    const pdfjs = await loadPdfjs();
    const worker = new pdfjs.PDFWorker(
      { port: workerPort } as unknown as ConstructorParameters<typeof pdfjs.PDFWorker>[0]
    );
    const task = pdfjs.getDocument({
      url: presentationStreamUrl(slug as ProductSlug),
      worker,
      // Range requests are what keep this from pulling a 24 MiB file to draw
      // one slide; the stream endpoint serves 206 responses.
      disableRange: false,
      disableStream: false,
    });
    return task.promise;
  })();

  documentCache.set(slug, { promise, refs: 1 });
  return promise;
}

function releaseDocument(slug: string): void {
  const entry = documentCache.get(slug);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;

  documentCache.delete(slug);
  entry.promise
    .then((doc) => doc.destroy())
    .catch(() => {
      /* The load already failed; there is nothing to tear down. */
    });
}

export async function renderPresentationThumbnail(req: ThumbnailRequest): Promise<void> {
  const { slug, page, canvas, width, maxDpr, signal } = req;
  if (!canvas) throw new Error('no canvas');
  if (signal?.aborted) throw new Error('aborted');

  let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
  const onAbort = () => renderTask?.cancel();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const doc = await acquireDocument(slug);
    if (signal?.aborted) throw new Error('aborted');

    // The server validated this page against the registry page count, but the
    // document is the final authority on its own length.
    const target = Math.min(Math.max(1, page), doc.numPages);
    const pdfPage = await doc.getPage(target);
    if (signal?.aborted) throw new Error('aborted');

    const base = pdfPage.getViewport({ scale: 1 });
    const scale = width / base.width;
    const viewport = pdfPage.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderTask = pdfPage.render({ canvasContext: context, viewport });
    await renderTask.promise;
    pdfPage.cleanup();
  } finally {
    signal?.removeEventListener('abort', onAbort);
    releaseDocument(slug);
  }
}

/** Test seam: drop every cached document. */
export function __resetThumbnailCache(): void {
  for (const slug of [...documentCache.keys()]) {
    const entry = documentCache.get(slug);
    if (entry) entry.refs = 1;
    releaseDocument(slug);
  }
  documentCache.clear();
}
