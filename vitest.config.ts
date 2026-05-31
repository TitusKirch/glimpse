import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for pure frontend logic (composables that don't need the Nuxt
// runtime). Nuxt-component tests would need @nuxt/test-utils; these don't.
export default defineConfig({
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
