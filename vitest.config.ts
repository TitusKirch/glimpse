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
    include: ['app/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      // The coverage gate covers the unit-testable layer: pure utilities, the
      // git IPC client, the IPC seam and the settings store. UI components,
      // Pinia stores wired to Tauri/DOM, and the Nuxt/Tauri runtime glue are
      // exercised by the e2e smoke test and manual QA, not unit coverage — so
      // they are intentionally outside this gate to keep it meaningful.
      include: [
        'app/utils/**/*.ts',
        'app/lib/**/*.ts',
        'app/stores/settings.ts',
        'app/composables/gitClient.ts',
        'app/composables/gitMock.ts',
        'app/composables/tauriInvoke.ts',
        'app/composables/isTauri.ts',
        'app/composables/cleanGitError.ts',
        'app/composables/parseConflicts.ts',
        'app/composables/parseDiff.ts',
        'app/composables/commitGraphLayout.ts',
        'app/composables/useSearch.ts'
      ],
      exclude: ['**/*.{test,spec}.ts'],
      thresholds: {
        // Branches sits a little lower: v8 counts defensive `?? fallback`
        // guards whose else-path is unreachable by construction.
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85
      }
    }
  }
});
