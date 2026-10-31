import { defineConfig } from 'vitest/config';

// Vite builds the site into dist/ for Cloudflare Pages (design.md § Web). Vitest runs the site tests in jsdom; the
// Pages Function opts into the node environment in its own test file.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'jsdom' },
});
