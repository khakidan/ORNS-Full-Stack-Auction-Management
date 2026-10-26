import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        devOptions: {
          enabled: true,
        },
        workbox: {
          // Workbox's generateSW default treats every full-page navigation
          // (Sec-Fetch-Mode: navigate) that isn't a precached asset as an
          // SPA deep link and serves the cached index.html for it - correct
          // for client-side routes like /AuctionItemsWorkflow, but it also
          // silently hijacks server-handled navigations like Google's
          // redirect to /auth/callback?code=..., which never reaches
          // authRoutes.ts at all as a result: the browser gets the cached
          // app shell instead of the real response, no session cookie is
          // ever set, and the app just reloads "logged out" - the exact
          // symptom behind an earlier "login loop" bug. Excluding /auth/ and
          // /api/ from the fallback lets those navigations hit the network
          // (and the real server) instead.
          navigateFallbackDenylist: [/^\/auth\//, /^\/api\//],
        },
        manifest: {
          name: 'Auction Management App',
          short_name: 'Auction App',
          description: 'Manages live and silent charity auctions for Orchard Ridge Nursery School - guest check-in, bidding, checkout, and receipts.',
          theme_color: '#e31b23',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/recharts/')) {
              return 'vendor-recharts';
            }
            if (id.includes('node_modules/framer-motion') || id.includes('node_modules/motion')) {
              return 'vendor-motion';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'vendor-lucide';
            }
            if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
              return 'vendor-firebase';
            }
            if (id.includes('node_modules/@base-ui/react')) {
              return 'vendor-base-ui';
            }
            if (id.includes('node_modules/html2canvas')) {
              // Kept out of vendor-utils deliberately - html2canvas is
              // only ever reached via a dynamic import() (see
              // screenshotCapture.ts) when a bug report includes a
              // screenshot. vendor-utils is already part of the eager
              // initial-load path (date-fns, clsx, etc.), so merging
              // html2canvas into it would defeat the lazy-load entirely.
              return 'vendor-html2canvas';
            }
            if (id.includes('node_modules')) {
              return 'vendor-utils';
            }
          },
        },
      },
    },
    server: {
      watch: {
        ignored: ['**/sessions/**', '**/bug-reports/**'],
      },
    },
  };
});
