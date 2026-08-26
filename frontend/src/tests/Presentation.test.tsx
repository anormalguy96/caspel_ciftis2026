import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProductPage } from '../pages/ProductPage';
import { PresentationPage } from '../pages/PresentationPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { resetPresentationManifestCache } from '../hooks/usePresentationManifest';
import type { PresentationManifest } from '../services/presentations';

vi.mock('../services/analytics', () => ({
  trackAnalyticsEvent: vi.fn(),
  getSessionId: () => 'test-session',
}));

// The viewer pulls in the pdf.js worker, which the test DOM cannot instantiate.
// Availability logic is what these tests are about.
vi.mock('../components/PdfViewer', () => ({
  PdfViewer: ({ url }: { url: string }) => <div data-testid="pdf-viewer" data-url={url} />,
}));

function entry(slug: string, available: boolean) {
  return {
    slug,
    name: slug,
    available,
    download_filename: `${slug}.pdf`,
    size_bytes: available ? 5_000_000 : null,
    page_count: available ? 24 : null,
  };
}

/** Corporate + ERP published; PMS + IRISSEA not yet supplied. */
function manifest(overrides: Partial<Record<string, boolean>> = {}): PresentationManifest {
  const defaults: Record<string, boolean> = {
    caspel: true,
    erp: true,
    pms: false,
    irissea: false,
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(defaults).map(([slug, available]) => [slug, entry(slug, available)])
  ) as PresentationManifest;
}

function mockManifest(data: PresentationManifest) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  );
}

function renderProduct(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/product/${slug}`]}>
      <Routes>
        <Route path="/product/:slug" element={<ProductPage />} />
        <Route path="/not-found" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderViewer(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/presentation/${slug}`]}>
      <Routes>
        <Route path="/presentation/:slug" element={<PresentationPage />} />
        <Route path="/not-found" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  resetPresentationManifestCache();
});

describe('Presentation availability comes from the server manifest', () => {
  it('offers View and Download when the deck is published', async () => {
    mockManifest(manifest());
    renderProduct('caspel');

    expect(await screen.findByRole('link', { name: /view presentation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download presentation/i })).toBeInTheDocument();
  });

  it('withholds both actions when the deck is not yet supplied', async () => {
    mockManifest(manifest());
    renderProduct('pms');

    expect(await screen.findByText(/not yet published/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view presentation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download presentation/i })).not.toBeInTheDocument();
  });

  it('publishes a deck the moment the server reports it, with no code change', async () => {
    mockManifest(manifest({ irissea: true }));
    renderProduct('irissea');

    expect(await screen.findByRole('link', { name: /view presentation/i })).toBeInTheDocument();
  });
});

describe('A manifest failure is reported as a failure, not as a missing deck', () => {
  it('shows a temporary error with Retry rather than "not yet published"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    renderProduct('caspel');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not reach the CASPEL server/i);
    // The distinction that matters: CASPEL has this deck. The server was
    // unreachable. Saying "not yet published" would be a false statement.
    expect(screen.queryByText(/not yet published/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('never offers View or Download while the manifest is unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    renderProduct('caspel');

    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: /view presentation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download presentation/i })).not.toBeInTheDocument();
  });

  it('recovers when Retry succeeds', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValue(
        new Response(JSON.stringify(manifest()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    renderProduct('caspel');
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('link', { name: /view presentation/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a retryable error on the viewer page too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    renderViewer('caspel');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not reach the CASPEL server/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
  });

  it('does not mount the viewer for an unpublished deck', async () => {
    mockManifest(manifest());
    renderViewer('pms');

    await waitFor(() => {
      expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
    });
  });
});

describe('Navigation has no dead ends', () => {
  it('shows a real 404 for an unknown slug instead of silently rendering Corporate', async () => {
    mockManifest(manifest());
    renderProduct('not-a-product');

    expect(await screen.findByText('404')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to caspel solutions/i })).toBeInTheDocument();
  });
});
