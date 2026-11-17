/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { localFirstBuild } from './localBuild.js';

// `npm run build:pages` builds with --mode pages: static assets are served
// from /circuitshield/ on GitHub Pages, and the client switches to the
// in-browser demo adapter instead of calling the Express API. The Pages
// build is also a local-first app: a Content-Security-Policy with no
// external hosts, a web app manifest and an offline service worker.
export default defineConfig(({ mode }) => {
  const isPagesBuild = mode === 'pages';
  // loadEnv reads .env / .env.local and lets an actual shell environment
  // variable of the same name override the file, which is what this config
  // itself needs since it runs in Node, not the browser.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      ...(isPagesBuild
        ? [localFirstBuild({
            base: '/circuitshield/',
            id: 'circuitshield',
            name: 'CircuitShield',
            description: 'Replay an incident timeline through a circuit breaker and tune its thresholds in your browser.',
          })]
        : []),
    ],
    base: isPagesBuild ? '/circuitshield/' : '/',
    // Fonts stay files, never data: URIs, so the policy can forbid data: fonts.
    build: { assetsInlineLimit: isPagesBuild ? 0 : undefined },
    // The replay worker is an ES module so it can import the shared breaker code.
    worker: { format: 'es' as const },
    define: {
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify(isPagesBuild ? 'true' : 'false'),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          // Override with VITE_API_TARGET (env var or client/.env.local) when
          // the server runs on a non-default port.
          target: env.VITE_API_TARGET || 'http://localhost:4004',
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
