import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { assertSafeBasePath, validatePublicUrl } from './src/config/basePath';

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
  const basePath = assertSafeBasePath(env.VITE_APP_BASE_PATH);
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
