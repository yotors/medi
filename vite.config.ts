import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // Serve font assets from this origin under the production font-src policy.
  build: { assetsInlineLimit: 0 },
  server: {
    host: '127.0.0.1',
    proxy: { '/api': { target: process.env.STAFF_API_TARGET ?? 'http://127.0.0.1:3100' } },
  },
});
