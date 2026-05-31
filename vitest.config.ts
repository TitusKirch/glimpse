import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Unit tests for pure frontend logic plus a few light component tests. Pure
// tests run in the node environment; component specs opt into happy-dom via a
// `// @vitest-environment happy-dom` docblock and stub Nuxt's auto-imports.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '@': fileURLToPath(new URL('./app', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['app/**/*.{test,spec}.ts']
  }
});
