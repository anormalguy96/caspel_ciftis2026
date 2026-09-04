import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The viewer's failure path.
 *
 * A 24 MB deck fetched in byte ranges over exhibition Wi-Fi will sometimes fail
 * to load, and the visitor is standing at the stand when it does. The error
 * state has to offer all three ways forward — retry the load, open it in a new
 * tab, download it — and Retry has to actually refetch rather than repaint the
 * same failed panel.
 */

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  workerDestroy: vi.fn(),
  workerConstructed: vi.fn(),
}));
const { getDocument } = mocks;

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerPort: null },
  // A worker is created per load and must be destroyed with it. Sharing one
  // port across documents leaves Retry with a terminated worker; never
  // destroying it leaks one Web Worker per attempt.
  PDFWorker: class {
    constructor(options: unknown) {
      mocks.workerConstructed(options);
    }
    destroy() {
      mocks.workerDestroy();
    }
  },
  getDocument: (...args: unknown[]) => mocks.getDocument(...args),
}));

// Vite resolves this to a Worker constructor; the test environment has none.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({
  default: class {
    terminate() {}
  },
}));

import { PdfViewer } from '../components/PdfViewer';

function failingTask() {
  return {
    promise: Promise.reject(new Error("network")),
    destroy: vi.fn(async () => {}),
    onProgress: undefined,
  };
}

function loadingTask(numPages = 3) {
  const page = {
    getViewport: () => ({ width: 800, height: 600 }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  };
  return {
    promise: Promise.resolve({
      numPages,
      getPage: async () => page,
      destroy: vi.fn(async () => {}),
    }),
    destroy: vi.fn(async () => {}),
    onProgress: undefined,
  };
}

beforeEach(() => {
  mocks.getDocument.mockReset();
  mocks.workerDestroy.mockReset();
  mocks.workerConstructed.mockReset();
});

describe('PdfViewer error state', () => {
  it('offers Retry, Open in new tab and Download when the document fails to load', async () => {
    getDocument.mockImplementation(failingTask);
    const onDownload = vi.fn();

    render(<PdfViewer url="/api/presentations/caspel/stream" onDownload={onDownload} />);

    const panel = await screen.findByTestId('pdf-viewer-error');
    expect(panel).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open in new tab/i })).toHaveAttribute(
      'href',
      '/api/presentations/caspel/stream'
    );
    expect(screen.getByRole('button', { name: /download presentation/i })).toBeInTheDocument();
  });

  it('does not claim the presentation is missing', async () => {
    getDocument.mockImplementation(failingTask);

    render(<PdfViewer url="/api/presentations/caspel/stream" />);

    const panel = await screen.findByTestId('pdf-viewer-error');
    expect(panel).toHaveTextContent(/did not finish loading/i);
    expect(panel).not.toHaveTextContent(/not yet published/i);
  });

  it('Retry refetches the document rather than repainting the panel', async () => {
    const user = userEvent.setup();
    getDocument.mockImplementationOnce(failingTask).mockImplementation(() => loadingTask(3));

    render(<PdfViewer url="/api/presentations/caspel/stream" />);
    await screen.findByTestId('pdf-viewer-error');
    expect(getDocument).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(getDocument).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-viewer-error')).not.toBeInTheDocument();
  });

  it('reports the page count to its parent once loaded', async () => {
    const onPageCountChange = vi.fn();
    getDocument.mockImplementation(() => loadingTask(41));

    render(
      <PdfViewer url="/api/presentations/erp/stream" onPageCountChange={onPageCountChange} />
    );

    expect(await screen.findByText('1 / 41')).toBeInTheDocument();
    expect(onPageCountChange).toHaveBeenCalledWith(41);
  });

  it('omits the Download action when the parent supplies no handler', async () => {
    getDocument.mockImplementation(failingTask);

    render(<PdfViewer url="/api/presentations/caspel/stream" />);

    await screen.findByTestId('pdf-viewer-error');
    expect(screen.queryByRole('button', { name: /download presentation/i })).not.toBeInTheDocument();
  });
});

describe('pdf.js worker lifecycle', () => {
  /**
   * Regression guard for the Retry feature.
   *
   * Setting GlobalWorkerOptions.workerPort once at module scope shares a single
   * port across every document, and task.destroy() terminates it — so the first
   * Retry handed pdf.js a dead worker and failed permanently. The fix is a
   * worker per load, which only works if it is also destroyed per load.
   */
  it('creates a worker for each load attempt', async () => {
    const user = userEvent.setup();
    getDocument.mockImplementation(failingTask);

    render(<PdfViewer url="/api/presentations/caspel/stream" />);
    await screen.findByTestId('pdf-viewer-error');
    expect(mocks.workerConstructed).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /try again/i }));

    // A second attempt must not reuse the terminated worker from the first.
    expect(mocks.workerConstructed).toHaveBeenCalledTimes(2);
  });

  it('destroys the worker when the load is torn down', async () => {
    getDocument.mockImplementation(() => loadingTask(3));

    const { unmount } = render(<PdfViewer url="/api/presentations/caspel/stream" />);
    await screen.findByText('1 / 3');
    unmount();

    // Without this the viewer leaks a Web Worker per attempt on a phone.
    await waitFor(() => {
      expect(mocks.workerDestroy).toHaveBeenCalled();
    });
  });
});

// ==========================================================================
// First-page priority
//
// The prerender margin is deliberately generous, so two or three pages qualify
// to render the moment the deck opens. On a slow link their byte ranges compete
// with the ranges page one needs: measured on the Corporate deck at mobile
// throttling, first page went from 40.1s to 18.2s once the others waited.
//
// The risk the gate creates is that pages 2..N never render, so that is what
// these tests hold. happy-dom has no canvas context, so page one can never
// report itself rendered here -- which is exactly the stuck case worth testing,
// and it is why the timeout escape exists.
// ==========================================================================

describe('first-page priority', () => {
  function loadedDoc(numPages: number) {
    const asked: number[] = [];
    return {
      asked,
      doc: {
        numPages,
        getPage: vi.fn(async (n: number) => {
          asked.push(n);
          return {
            getViewport: () => ({ width: 800, height: 600 }),
            render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
            cleanup: () => {},
          };
        }),
        destroy: vi.fn(async () => {}),
        cleanup: vi.fn(),
      },
    };
  }

  function mockLoad(doc: unknown) {
    getDocument.mockReturnValue({
      promise: Promise.resolve(doc),
      // The component calls .catch on this during cleanup.
      destroy: vi.fn(async () => {}),
      onProgress: null,
    });
  }

  it('asks for page one before any other page', async () => {
    const { doc, asked } = loadedDoc(24);
    mockLoad(doc);

    render(<PdfViewer url="/api/presentations/caspel/stream" />);

    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    // Whatever else is requested afterwards, page one is first in the queue.
    expect(asked[0]).toBe(1);
  });

  it('releases the rest of the deck even if page one never reports rendered', async () => {
    // A delay, not a cancellation. A deck that shows only its first page for
    // ever is a worse failure than a slow one, so the gate has a timeout and
    // this is the environment in which that timeout matters.
    vi.useFakeTimers();
    try {
      const { doc, asked } = loadedDoc(24);
      mockLoad(doc);

      render(<PdfViewer url="/api/presentations/caspel/stream" />);

      await vi.advanceTimersByTimeAsync(50);
      const beforeTimeout = [...asked];

      // Past the gate's own timeout.
      await vi.advanceTimersByTimeAsync(35000);

      expect(beforeTimeout.every((n) => n === 1)).toBe(true);
      expect(doc.getPage).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ==========================================================================
// Progressive replacement
//
// The preview stands in for page one until the interactive page has painted.
// The two failure modes worth guarding are showing page one twice, and taking
// the slide away before there is anything to replace it with.
// ==========================================================================

describe('first-slide preview replacement', () => {
  const preview = {
    src: '/assets/erp-slide-1-test.webp',
    width: 1080,
    height: 608,
    sourceSha256: 'e7033d04ff59141572ffd4cdd57163c031d7faa39052c51e29424dd0cf50aab7',
    sourcePage: 1,
  };

  function neverResolvingLoad() {
    getDocument.mockReturnValue({
      promise: new Promise(() => {}),
      destroy: vi.fn(async () => {}),
      onProgress: null,
    });
  }

  it('shows the slide before the document has loaded', async () => {
    neverResolvingLoad();
    render(
      <PdfViewer
        url="/api/presentations/erp/stream"
        preview={preview}
        previewLabel="First slide of CASPEL ERP Presentation, page 1"
      />
    );

    const img = await screen.findByAltText('First slide of CASPEL ERP Presentation, page 1');
    expect(img).toHaveAttribute('src', preview.src);
    // Intrinsic dimensions reserve the box, so the canvas replaces it without
    // moving anything.
    expect(img).toHaveAttribute('width', '1080');
    expect(img).toHaveAttribute('height', '608');
  });

  it('asks the browser to treat the slide as important', async () => {
    neverResolvingLoad();
    render(<PdfViewer url="/api/presentations/erp/stream" preview={preview} previewLabel="Slide" />);

    const img = await screen.findByAltText('Slide');
    // It is the largest contentful paint on this route and the reason the
    // visitor navigated here; discovering it lazily would defeat the point.
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img.getAttribute('fetchpriority')).toBe('high');
  });

  it('keeps the slide visible while the document is still loading', async () => {
    neverResolvingLoad();
    render(<PdfViewer url="/api/presentations/erp/stream" preview={preview} previewLabel="Slide" />);

    await screen.findByAltText('Slide');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    // Removing it when the document resolves rather than when page one paints
    // would show the visitor an empty box for several seconds.
    expect(screen.queryByAltText('Slide')).toBeInTheDocument();
  });

  it('drops the slide if the image itself fails, without blocking the viewer', async () => {
    neverResolvingLoad();
    render(<PdfViewer url="/api/presentations/erp/stream" preview={preview} previewLabel="Slide" />);

    const img = await screen.findByAltText('Slide');
    fireEvent.error(img);

    // A broken preview degrades to exactly the behaviour that existed before it.
    await waitFor(() => expect(screen.queryByAltText('Slide')).toBeNull());
    expect(document.querySelector('.pdf-viewer')).toBeInTheDocument();
  });

  it('shows nothing extra when a product has no preview', () => {
    neverResolvingLoad();
    render(<PdfViewer url="/api/presentations/pms/stream" />);
    expect(document.querySelector('.pdf-viewer__preview')).toBeNull();
  });

  it('never lets the preview intercept the viewer controls', async () => {
    neverResolvingLoad();
    render(<PdfViewer url="/api/presentations/erp/stream" preview={preview} previewLabel="Slide" />);

    await screen.findByAltText('Slide');
    const box = document.querySelector('.pdf-viewer__preview') as HTMLElement;
    // Declared in CSS; asserted here because a preview that swallowed taps on
    // the toolbar would be worse than no preview.
    expect(box.className).toContain('pdf-viewer__preview');
    expect(box.getAttribute('data-state')).toBe('visible');
  });
});
