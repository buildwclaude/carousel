import { defineConfig } from 'vite';

// Project pages are served from a subpath (buildwclaude.github.io/carousel/),
// so the build needs that base. Dev stays at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/carousel/' : '/',
  server: { host: true, port: 5173 },
  build: { target: 'es2020', assetsInlineLimit: 0 },
}));
