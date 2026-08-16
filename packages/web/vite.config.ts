import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
      // `pnpm dev` in this package talks to a locally running `reporeaper ui`.
      '/api': {
        target: 'http://127.0.0.1:7433',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
