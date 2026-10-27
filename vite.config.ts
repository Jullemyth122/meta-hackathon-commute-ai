import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * Two entry points, on purpose:
 *   index.html  laptop dashboard (Three.js, heavy)
 *   track.html  phone tracker    (no Three.js, loads fast on mobile data)
 *
 * `npm run dev:phone` serves over self-signed HTTPS on the LAN, because
 * browsers only expose the Geolocation API on secure origins.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react(), mode === 'phone' && basicSsl()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  build: {
    target: 'es2022',
    // three/webgpu alone is ~1.3 MB minified (≈400 kB gzip). It only loads on the
    // dashboard; the phone tracker never imports it.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        track: resolve(import.meta.dirname, 'track.html'),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
