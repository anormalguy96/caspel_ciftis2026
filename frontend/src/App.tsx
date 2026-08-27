import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ROUTER_BASENAME } from './config/paths';
import { LandingPage } from './pages/LandingPage';

const ProductPage = lazy(() => import('./pages/ProductPage').then(m => ({ default: m.ProductPage })));
const PresentationPage = lazy(() => import('./pages/PresentationPage').then(m => ({ default: m.PresentationPage })));
const DisplayPage = lazy(() => import('./pages/DisplayPage').then(m => ({ default: m.DisplayPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));

/**
 * Route-level fallback. Uses the shared token palette rather than hardcoded
 * hex so it matches the app it is standing in for.
 */
const RouteFallback: React.FC = () => (
  <div className="route-fallback" role="status" aria-live="polite">
    <span className="u-dots" aria-hidden="true">
      <span style={{ ['--i' as string]: 0 }} />
      <span style={{ ['--i' as string]: 1 }} />
      <span style={{ ['--i' as string]: 2 }} />
    </span>
    <span className="route-fallback__text">Loading</span>
  </div>
);

/**
 * Public exhibition surfaces only.
 *
 * There is deliberately no /ciftis/admin and no /ciftis/status. A booth site
 * reachable by QR code from a public hall must not carry a login form or an
 * operational telemetry screen: the first is an unattended credential surface,
 * the second discloses infrastructure to anyone who guesses the path.
 */
export const App: React.FC = () => {
  return (
    <BrowserRouter basename={ROUTER_BASENAME}>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/display" element={<DisplayPage />} />
          <Route path="/product/:slug" element={<ProductPage />} />
          <Route path="/presentation/:slug" element={<PresentationPage />} />
          <Route path="/not-found" element={<NotFoundPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};
