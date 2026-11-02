import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works from any sub-path (GitHub Pages /<repo>/, Capacitor file://)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
} as any);
