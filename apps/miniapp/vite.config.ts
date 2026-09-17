import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { precompress } from '../../scripts/precompress.mjs';

/** Куда ходить за API в разработке: там же, где он поднимается стендом. */
const API = process.env['VITE_API_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), precompress()],
  base: './',
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ['/api', '/auth', '/health', '/hub'].map((path) => [path, { target: API, changeOrigin: true }]),
    ),
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { index: fileURLToPath(new URL('index.html', import.meta.url)) },
    },
  },
});
