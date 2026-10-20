import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Vite server proxies /api to the FastAPI backend, so the app can use
// relative URLs everywhere. In production the backend serves the built files itself.
// VITE_PROXY_TARGET points the dev server at another backend instance (e.g. a test port).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
