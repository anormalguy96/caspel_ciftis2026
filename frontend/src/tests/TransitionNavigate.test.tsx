import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { transitionNavigate } from '../utils/transitionNavigate';
import { ProductCard } from '../components/ProductCard';
import { ProductConfig } from '../types';

describe('transitionNavigate architecture', () => {
  let mockNavigate: ReturnType<typeof vi.fn>;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    mockNavigate = vi.fn();
    originalMatchMedia = window.matchMedia;

    // Reset document.startViewTransition
    if ('startViewTransition' in document) {
      delete (document as unknown as Record<string, unknown>).startViewTransition;
    }

    // Default matchMedia mock (no reduced motion)
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('unsupported browser: executes normal navigate exactly once when startViewTransition is missing', () => {
    transitionNavigate(mockNavigate, '/product/erp');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/product/erp', undefined);
  });

  it('reduced motion: bypasses startViewTransition when prefers-reduced-motion is active', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const mockStartViewTransition = vi.fn();
    (document as unknown as Record<string, unknown>).startViewTransition = mockStartViewTransition;

    transitionNavigate(mockNavigate, '/product/erp');

    expect(mockStartViewTransition).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/product/erp', undefined);
  });

  it('supported environment: invokes startViewTransition and runs navigate in callback exactly once', () => {
    const mockStartViewTransition = vi.fn().mockImplementation((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    (document as unknown as Record<string, unknown>).startViewTransition = mockStartViewTransition;

    transitionNavigate(mockNavigate, '/product/corporate');

    expect(mockStartViewTransition).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/product/corporate', undefined);
  });

  it('supports string route navigation', () => {
    transitionNavigate(mockNavigate, '/product/iris-sea');
    expect(mockNavigate).toHaveBeenCalledWith('/product/iris-sea', undefined);
  });

  it('supports history numeric back navigation (navigate(-1))', () => {
    transitionNavigate(mockNavigate, -1);
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('setup failure: executes fallback navigate exactly once if startViewTransition throws synchronously', () => {
    const mockStartViewTransition = vi.fn().mockImplementation(() => {
      throw new Error('ViewTransition error');
    });
    (document as unknown as Record<string, unknown>).startViewTransition = mockStartViewTransition;

    expect(() => {
      transitionNavigate(mockNavigate, '/product/erp');
    }).not.toThrow();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/product/erp', undefined);
  });

  it('handles update callback throw safely without double navigation', () => {
    const mockStartViewTransition = vi.fn().mockImplementation((cb: () => void) => {
      cb();
      throw new Error('Callback phase error');
    });
    (document as unknown as Record<string, unknown>).startViewTransition = mockStartViewTransition;

    expect(() => {
      transitionNavigate(mockNavigate, '/product/erp');
    }).not.toThrow();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});

describe('ProductCard link activation & modified click semantics', () => {
  const testProduct: ProductConfig = {
    slug: 'caspel',
    name: 'CASPEL Corporate',
    descriptor: 'Integrated Technology Systems & Infrastructure Solutions',
    description: 'Corporate overview presentation',
    presentationUrl: '/api/presentations/caspel/stream',
    downloadFilename: 'CASPEL_Corporate_Presentation.pdf',
  };

  it('renders a real anchor with correct href for SEO and browser semantics', () => {
    render(
      <MemoryRouter>
        <ProductCard product={testProduct} index={0} />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: new RegExp(testProduct.name, 'i') });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe(`/product/${testProduct.slug}`);
  });

  it('ordinary left click triggers defaultPrevented for SPA transitionNavigate', () => {
    render(
      <MemoryRouter>
        <ProductCard product={testProduct} index={0} />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: new RegExp(testProduct.name, 'i') });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    const prevented = !link.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it('modified click (Ctrl/Cmd/Shift/Alt) is NOT intercepted by SPA handler', () => {
    render(
      <MemoryRouter>
        <ProductCard product={testProduct} index={0} />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: new RegExp(testProduct.name, 'i') });

    // Ctrl click
    const ctrlEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    const ctrlPrevented = !link.dispatchEvent(ctrlEvent);
    expect(ctrlPrevented).toBe(false);

    // Cmd click (metaKey)
    const metaEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
    const metaPrevented = !link.dispatchEvent(metaEvent);
    expect(metaPrevented).toBe(false);

    // Shift click
    const shiftEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, shiftKey: true });
    const shiftPrevented = !link.dispatchEvent(shiftEvent);
    expect(shiftPrevented).toBe(false);
  });
});
