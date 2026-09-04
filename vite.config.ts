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
        manifest: {
          name: 'ORNS Charity Auction Manager',
          short_name: 'ORNS Auction',
          description: 'Manages live and silent charity auctions for Oakridge Neighborhood School - guest check-in, bidding, checkout, and receipts.',
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
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      watch: {
        ignored: ['**/sessions/**', '**/src-tauri/**', '**/dist-desktop/**'],
      },
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
