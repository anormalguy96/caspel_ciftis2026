import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
