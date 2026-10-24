import { defineConfig } from 'vite';
export default defineConfig({
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8787', '/uploads': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
});
