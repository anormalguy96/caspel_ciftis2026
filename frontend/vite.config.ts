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

/**
 * Preloads the font the stylesheet actually asks for.
 *
 * The font is imported from CSS, so the browser cannot discover it until the
 * stylesheet has arrived and parsed. On a throttled mobile connection that is
 * most of a second after the document, and text renders in the fallback face
 * until it lands.
 *
 * index.html used to carry a hardcoded preload for `fonts/Inter-var.woff2`.
 * That file does not exist -- there is no `public/fonts` directory. The SPA
 * fallback answered the request with index.html, the browser discarded it as
 * the wrong content type, and the real font was still discovered late. Measured
 * on the landing route: two font requests, one of them 2.7 KiB of HTML, and no
 * preload benefit at all.
 *
 * Only the build knows the hashed filename, so the link is injected from the
 * bundle rather than written by hand. A renamed or removed font produces no
 * preload instead of a broken one, and the base path comes from the same
 * validated value as every other URL, so Mode A and Mode B both stay correct.
 */
function fontPreloadPlugin(basePath: string): Plugin {
  return {
    name: 'caspel-font-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const font = Object.keys(ctx.bundle ?? {}).find((file) =>
          /Inter-var.*.woff2$/.test(file)
        );
        if (!font) return html;
        return {
          html,
          tags: [
            {
              tag: 'link',
              attrs: {
                rel: 'preload',
                href: `${basePath}${font}`,
                as: 'font',
                type: 'font/woff2',
                crossorigin: '',
              },
              injectTo: 'head',
            },
          ],
        };
      },
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
    plugins: [react(), publicConfigPlugin(basePath, publicUrl), fontPreloadPlugin(basePath)],
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
