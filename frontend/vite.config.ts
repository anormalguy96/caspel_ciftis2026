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

/**
 * Starts a route's own code downloading at the same time as the main bundle.
 *
 * Code splitting keeps the landing page small, and it costs the split routes a
 * serial round trip: the browser cannot know a route chunk exists until the
 * main bundle has been fetched, parsed and executed far enough to reach the
 * dynamic import. Traced on the ERP viewer at mobile throttling (150ms RTT,
 * 1638kbps, CPU x4):
 *
 *   0 -  990ms  document
 *   1043 - 1806ms  index + vendor + css + font
 *   1962 - 2724ms  ProductPage chunk, pdf chunk        <- idle until 1962ms
 *   ~3072ms        viewer bar paints, and is the LCP element
 *
 * The 156ms gap between the main bundle landing and the route chunk starting is
 * parse-and-execute; the chunk itself then needs its own round trip on a 150ms
 * link. Declaring it in the document removes that wait, because the browser can
 * fetch it alongside the bundle that will ask for it.
 *
 * Only the route being visited is preloaded. A blanket set of modulepreload
 * links in index.html would make the landing page pay for the viewer and the
 * display wall, which is the regression code splitting exists to prevent -- so
 * the choice is made in the document from `location.pathname`, and a visitor on
 * `/` downloads nothing extra.
 *
 * The chunk names carry content hashes, so the map is written from the bundle at
 * build time. A renamed page emits no entry rather than a stale one, and the
 * base path comes from the same validated value as every other URL, so Mode A
 * and Mode B are both correct.
 */
function routeChunkPreloadPlugin(basePath: string): Plugin {
  // Matched against the emitted file names, which Rollup derives from the
  // source module, and against the path a visitor is on.
  const ROUTES: ReadonlyArray<{ test: string; chunk: RegExp }> = [
    { test: '/product/', chunk: /(^|\/)ProductPage-[^/]+\.js$/ },
    { test: '/display', chunk: /(^|\/)DisplayPage-[^/]+\.js$/ },
  ];

  return {
    name: 'caspel-route-chunk-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;

        /** A chunk plus everything it statically imports, transitively. */
        const withDependencies = (entry: string): string[] => {
          const seen = new Set<string>();
          const queue = [entry];
          while (queue.length) {
            const file = queue.shift() as string;
            if (seen.has(file)) continue;
            seen.add(file);
            const chunk = bundle[file];
            if (chunk && chunk.type === 'chunk') {
              for (const next of chunk.imports) queue.push(next);
            }
          }
          return Array.from(seen);
        };

        const map: Record<string, string[]> = {};
        for (const route of ROUTES) {
          const entry = Object.keys(bundle).find((file) => route.chunk.test(file));
          if (!entry) continue;
          const files = withDependencies(entry)
            // The entry bundle and its vendor chunk are already <script> tags in
            // this document. A second declaration of them is deduplicated by the
            // browser but says nothing, so it is left out.
            .filter((file) => !html.includes(file))
            .map((file) => `${basePath}${file}`);
          if (files.length) map[route.test] = files;
        }
        if (!Object.keys(map).length) return html;

        // Inlined rather than imported: a preload hint that needs its own
        // request to arrive has already lost the time it exists to save.
        const script = `(function(){var m=${JSON.stringify(map)},p=location.pathname;` +
          `for(var k in m){if(p.indexOf(k)===-1)continue;` +
          `for(var i=0;i<m[k].length;i++){var l=document.createElement('link');` +
          `l.rel='modulepreload';l.href=m[k][i];document.head.appendChild(l);}break;}})();`;

        return {
          html,
          tags: [{ tag: 'script', children: script, injectTo: 'head' }],
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
    plugins: [
      react(),
      publicConfigPlugin(basePath, publicUrl),
      fontPreloadPlugin(basePath),
      routeChunkPreloadPlugin(basePath),
    ],
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
