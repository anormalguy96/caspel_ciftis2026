import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Public mount configuration.
 *
 * The hub is deployed either at the root of its own subdomain or beneath a path
 * on the corporate site, and Vite inlines both values at build time — there is
 * no runtime fix once the bundle is built or the QR code printed. So both are
 * validated here and a bad value fails the build rather than shipping.
 *
 *   VITE_APP_BASE_PATH  where the SPA is mounted   "/"  or  "/ciftis/"
 *   VITE_PUBLIC_URL     absolute public address    "https://ciftis.caspel.com"
 *                                                  "https://caspel.com/ciftis"
 *
 * Neither is a secret; both appear verbatim in the shipped HTML.
 */

const BASE_PATH_PATTERN = /^\/(?:[A-Za-z0-9][A-Za-z0-9._~-]*\/)*$/;

export function normalizeBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed === '/') return '/';

  if (/\s/.test(trimmed)) {
    throw new Error(`[caspel] VITE_APP_BASE_PATH contains whitespace: ${JSON.stringify(raw)}`);
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//')) {
    throw new Error(
      `[caspel] VITE_APP_BASE_PATH must be a path, not a URL or protocol-relative value: ${trimmed}`
    );
  }
  if (trimmed.includes('..')) {
    throw new Error(`[caspel] VITE_APP_BASE_PATH must not contain "..": ${trimmed}`);
  }

  const collapsed = trimmed.replace(/\/{2,}/g, '/');
  const withLeading = collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
  const normalized = withLeading.endsWith('/') ? withLeading : `${withLeading}/`;

  if (!BASE_PATH_PATTERN.test(normalized)) {
    throw new Error(
      `[caspel] VITE_APP_BASE_PATH is not a safe path: ${trimmed}. ` +
        'Use "/" or "/segment/" with unreserved characters only.'
    );
  }
  return normalized;
}

export function validatePublicUrl(raw: string | undefined, basePath: string, isProduction: boolean): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');

  if (!isProduction) return value || 'http://localhost:5173';

  if (!value) {
    throw new Error(
      '[caspel] VITE_PUBLIC_URL is not set. A production build must know its own public ' +
        'address: canonical, Open Graph and QR URLs are baked in at build time.'
    );
  }
  if (!/^https:\/\//i.test(value)) {
    throw new Error(`[caspel] VITE_PUBLIC_URL must be an https:// address, got: ${value}`);
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(value)) {
    throw new Error(
      `[caspel] VITE_PUBLIC_URL is ${value}, a loopback address. Shared links and the printed ` +
        'QR code would point at the build machine.'
    );
  }

  // The two values describe the same mount point from different sides. If they
  // disagree, every canonical link is wrong in a way nothing else would catch.
  const path = new URL(value).pathname.replace(/\/+$/, '') || '/';
  const expected = basePath === '/' ? '/' : basePath.replace(/\/$/, '');
  if (path !== expected) {
    throw new Error(
      `[caspel] VITE_PUBLIC_URL path "${path}" does not match VITE_APP_BASE_PATH "${basePath}". ` +
        `Expected the URL to end at "${expected}".`
    );
  }
  return value;
}

/**
 * Substitute the public values into index.html.
 *
 * A private sentinel is used instead of Vite's %VAR% syntax because Vite tries
 * to URI-decode an unresolved %VITE_…% token before transformIndexHtml runs.
 */
function publicConfigPlugin(basePath: string, publicUrl: string): Plugin {
  return {
    name: 'caspel-public-config',
    transformIndexHtml(html) {
      return html
        .split('__VITE_PUBLIC_URL__').join(publicUrl)
        .split('__VITE_APP_BASE_PATH__').join(basePath);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isProduction = mode === 'production';
  const basePath = normalizeBasePath(env.VITE_APP_BASE_PATH);
  const publicUrl = validatePublicUrl(env.VITE_PUBLIC_URL, basePath, isProduction);

  return {
    base: basePath,
    plugins: [react(), publicConfigPlugin(basePath, publicUrl)],
    define: {
      // Mirrors the validated value into the bundle so paths.ts can expose it
      // without re-deriving anything at runtime.
      'import.meta.env.VITE_PUBLIC_URL': JSON.stringify(publicUrl),
    },
    test: {
      globals: true,
      // happy-dom, not 'node': component behaviour (clicks, effects, conditional
      // rendering) cannot be tested without a DOM.
      environment: 'happy-dom',
      setupFiles: ['./src/tests/setup.ts'],
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        // Dev server proxies the API at whatever base the build uses.
        [`${basePath}api`]: {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(new RegExp(`^${basePath}api`), '/api'),
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            qr: ['qrcode.react'],
            icons: ['lucide-react'],
          },
        },
      },
    },
  };
});
