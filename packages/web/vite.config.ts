import { existsSync, readFileSync } from 'node:fs';
import { devSessionPath } from '@reporeaper/core/dev-session';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_PORT = 7433;

/**
 * Reads the secret published by `reporeaper ui --dev-session`.
 *
 * Read per request rather than once at startup, so restarting the server does
 * not require restarting Vite.
 */
function devSessionToken(): string | null {
  const path = devSessionPath(API_PORT);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The single canonical location for the built SPA. The cli package serves
    // this directory and ships it in the published tarball, so there is no
    // copy step to drift out of sync.
    outDir: '../cli/dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Development only. `pnpm dev` serves this SPA with hot reload while the
      // API comes from a separate `reporeaper ui --dev-session` process.
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        // The server only accepts a loopback Host on its own port, so the
        // forwarded request must carry the target's Host, not Vite's.
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyRequest) => {
            // In a real run our own server injects this secret into the page it
            // serves. Vite serves the page here, so the secret has to come from
            // the file the server published instead.
            const token = devSessionToken();
            if (token) proxyRequest.setHeader('x-session-token', token);
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
