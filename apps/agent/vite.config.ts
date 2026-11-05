import { defineConfig } from 'vitest/config';

// Vite builds the window into dist/, which Tauri serves as frontendDist (design.md § UI). Vitest runs the window
// tests in jsdom.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'jsdom' },
});
