import { defineConfig } from 'vite';
import { loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Substitute __VITE_PUBLIC_SITE_URL__ in index.html.
 *
 * Open Graph, Twitter and canonical tags need an absolute URL, and Vite inlines
 * it at build time — there is no runtime fix for a wrong value. A private
 * sentinel is used instead of Vite's %VAR% syntax because Vite tries to
 * URI-decode an unresolved %VITE_PUBLIC_SITE_URL% token before
 * transformIndexHtml runs.
 *
 * A production build with a missing or localhost site URL FAILS. It used to
 * warn and fall back to http://localhost:8080, which produced a deployable
 * bundle whose canonical link, share cards and QR target all pointed at the
 * build machine. That is not something anyone notices until a visitor scans the
 * printed code at the stand.
 */
function siteUrlPlugin(mode: string): Plugin {
  return {
    name: 'caspel-site-url',
    transformIndexHtml(html) {
      const env = loadEnv(mode, process.cwd(), '');
      const raw = (env.VITE_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
      const isProduction = mode === 'production';

      if (isProduction) {
        if (!raw) {
          throw new Error(
            '[caspel] VITE_PUBLIC_SITE_URL is not set. A production build must know its own ' +
              'public origin: canonical, Open Graph and QR URLs are baked in at build time. ' +
              'Set it to the real https:// origin and rebuild.'
          );
        }
        if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(raw)) {
          throw new Error(
            `[caspel] VITE_PUBLIC_SITE_URL is ${raw}, which is a loopback address. Shared ` +
              'links and the printed QR code would point at the build machine. Set it to the ' +
              'real public origin and rebuild.'
          );
        }
        if (!/^https:\/\//i.test(raw)) {
          throw new Error(
            `[caspel] VITE_PUBLIC_SITE_URL is ${raw}. A production origin must be https://.`
          );
        }
      }

      const siteUrl = raw || 'http://localhost:5173';
      return html.split('__VITE_PUBLIC_SITE_URL__').join(siteUrl);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), siteUrlPlugin(mode)],
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
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
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
}));
