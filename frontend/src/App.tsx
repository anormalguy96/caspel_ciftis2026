import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ROUTER_BASENAME } from './config/paths';
import { LandingPage } from './pages/LandingPage';
import { safeLazy } from './utils/safeLazy';

const ProductPage = safeLazy(() => import('./pages/ProductPage'), 'ProductPage');
const PresentationPage = safeLazy(() => import('./pages/PresentationPage'), 'PresentationPage');
const DisplayPage = safeLazy(() => import('./pages/DisplayPage'), 'DisplayPage');
const NotFoundPage = safeLazy(() => import('./pages/NotFoundPage'), 'NotFoundPage');

/**
 * Route-level fallback. Uses the shared token palette rather than hardcoded
 * hex so it matches the app it is standing in for.
 */
const RouteFallback: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <span className="u-dots" aria-hidden="true">
        <span style={{ ['--i' as string]: 0 }} />
        <span style={{ ['--i' as string]: 1 }} />
        <span style={{ ['--i' as string]: 2 }} />
      </span>
      <span className="route-fallback__text">{t('app.loading')}</span>
    </div>
  );
};

/**
 * The route table, exported so the deployment-mode matrix can be asserted
 * directly rather than inferred from rendered output.
 *
 * Paths here are always basename-relative. The public prefix belongs to
 * ROUTER_BASENAME and to nothing else: a literal "/ciftis" route declared
 * alongside a "/ciftis" basename does not serve Mode B, it serves
 * /ciftis/ciftis, and every page ends up with a second working address that
 * competes with the canonical one the QR code points at.
 */
export const ROUTE_DEFINITIONS = [
  { id: 'landing', path: '/' },
  { id: 'display', path: '/display' },
  { id: 'product', path: '/product/:slug' },
  { id: 'presentation', path: '/presentation/:slug' },
  { id: 'notFound', path: '/not-found' },
  { id: 'catchAll', path: '*' },
] as const;

export type RouteId = (typeof ROUTE_DEFINITIONS)[number]['id'];

const ROUTE_ELEMENTS: Record<RouteId, React.ReactNode> = {
  landing: <LandingPage />,
  display: <DisplayPage />,
  product: <ProductPage />,
  presentation: <PresentationPage />,
  notFound: <NotFoundPage />,
  catchAll: <NotFoundPage />,
};

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
          {ROUTE_DEFINITIONS.map(({ id, path }) => (
            <Route key={id} path={path} element={ROUTE_ELEMENTS[id]} />
          ))}
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};
