import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { appSourcemaps } from './build/appSourcemaps';
import pkg from './package.json' with { type: 'json' };

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-05-30',

  // Desktop app: single-page, no server rendering.
  ssr: false,

  runtimeConfig: {
    public: {
      // Baked in here so the fatal error page (app/error.vue) can report the
      // version without asking the desktop shell over IPC — by the time that
      // page renders, the app never got far enough to ask. Kept in step with
      // src-tauri/tauri.conf.json by release-please.
      appVersion: pkg.version
    }
  },

  // Ship client source maps so a release stack trace names a file under `app/`
  // and a line, instead of `ClNIOtIm.js:1:48213`. The maps the build emits
  // cover every dependency too (~8 MB against a 2.4 MB bundle); the
  // `appSourcemaps` plugin below strips them back to this repo's own code.
  sourcemap: { client: true, server: false },

  modules: [
    '@nuxt/icon',
    '@nuxtjs/color-mode',
    '@pinia/nuxt',
    'pinia-plugin-persistedstate/nuxt',
    '@nuxtjs/i18n',
    'shadcn-nuxt'
  ],

  icon: {
    componentName: 'NuxtIcon',
    // A server bundle needs a server to serve from. This app is `ssr: false`
    // and the desktop shell loads the built files off disk, so /api/_nuxt_icon
    // never exists at runtime and every icon fell through to the public
    // Iconify API — one batched request, which is why the sidebar painted all
    // its labels and then all its icons at once, half a second later. A git
    // client that needs the network to draw its own chrome is the worse half
    // of that bug.
    serverBundle: false,
    clientBundle: {
      // Compiles the icons referenced in source into the client bundle.
      scan: true,
      // flagFor() builds `flag:<region>-4x3` from the locale tag at runtime, so
      // the scan cannot see these. The locales are enumerated in `i18n` below,
      // which makes the set finite: add a locale, add its flag here.
      icons: ['flag:gb-4x3', 'flag:de-4x3', 'flag:fr-4x3', 'flag:es-4x3'],
      sizeLimitKb: 1024
    }
  },

  css: ['~/assets/css/tailwind.css', 'vue-sonner/style.css'],

  vite: {
    plugins: [
      tailwindcss(),
      appSourcemaps({
        rootDir: fileURLToPath(new URL('.', import.meta.url)),
        appDir: fileURLToPath(new URL('./app', import.meta.url))
      })
    ],
    // Tauri expects a fixed dev server; fail loudly instead of hopping ports.
    clearScreen: false,
    server: { strictPort: true },
    // vue-sonner keeps its toast queue in a module-level singleton; a second
    // copy means the mounted <Toaster> never sees toast() calls. Force one.
    resolve: { dedupe: ['vue-sonner'] },
    // Pre-bundle these so Vite doesn't re-optimize mid-load and force a reload
    // (which can leave the Tauri webview on a blank/black screen).
    optimizeDeps: {
      include: [
        '@tauri-apps/api/app',
        '@tauri-apps/api/core',
        '@tauri-apps/api/event',
        '@tauri-apps/plugin-dialog',
        '@tauri-apps/plugin-opener',
        // Loaded lazily by app/error.vue, so pre-bundling it matters twice over.
        '@tauri-apps/plugin-os',
        '@tauri-apps/plugin-deep-link',
        '@tauri-apps/plugin-updater',
        '@tanstack/vue-virtual',
        '@tanstack/vue-form',
        'zod',
        '@vueuse/core',
        'class-variance-authority',
        'clsx',
        'fuse.js',
        'highlight.js',
        'reka-ui',
        'tailwind-merge',
        'vue-sonner',
        // vuedraggable ships CJS; pre-bundle so Vite resolves it to ESM up
        // front instead of re-optimizing mid-load. (Its sortablejs core is
        // pulled in transitively — pnpm's isolated linker keeps it nested, so
        // it can't be a standalone include entry.)
        'vuedraggable'
      ]
    }
  },

  // Persist Pinia stores in localStorage (the module defaults to cookies,
  // which the Tauri webview doesn't keep across restarts).
  piniaPluginPersistedstate: {
    storage: 'localStorage'
  },

  // class-based dark mode driven by the `.dark` / `.light` class on <html>.
  colorMode: {
    classSuffix: '',
    preference: 'system',
    fallback: 'dark'
  },

  shadcn: {
    prefix: 'Ui',
    componentDir: '~/components/ui'
  },

  i18n: {
    defaultLocale: 'en-GB',
    // NOTE: this only decides which message files get *preloaded* so a fallback
    // locale's catalogue is in memory. The lookup-time fallback that actually
    // substitutes a missing key lives in i18n/i18n.config.ts (vue-i18n runtime
    // options) — keep the two chains identical. fr-FR / es-ES are partial today,
    // so this is what makes them usable; `default` covers locales we don't ship.
    fallbackLocale: {
      'de-DE': ['en-GB'],
      'fr-FR': ['en-GB'],
      'es-ES': ['en-GB'],
      default: ['en-GB']
    },
    strategy: 'no_prefix',
    // One directory per locale with namespaced files; i18n deep-merges them.
    locales: [
      {
        code: 'en-GB',
        language: 'en-GB',
        files: [
          'en-GB/common.json',
          'en-GB/sidebar.json',
          'en-GB/changes.json',
          'en-GB/history.json',
          'en-GB/diff.json',
          'en-GB/settings.json'
        ]
      },
      {
        code: 'de-DE',
        language: 'de-DE',
        files: [
          'de-DE/common.json',
          'de-DE/sidebar.json',
          'de-DE/changes.json',
          'de-DE/history.json',
          'de-DE/diff.json',
          'de-DE/settings.json'
        ]
      },
      {
        code: 'fr-FR',
        language: 'fr-FR',
        files: [
          'fr-FR/common.json',
          'fr-FR/sidebar.json',
          'fr-FR/changes.json',
          'fr-FR/history.json',
          'fr-FR/diff.json',
          'fr-FR/settings.json'
        ]
      },
      {
        code: 'es-ES',
        language: 'es-ES',
        files: [
          'es-ES/common.json',
          'es-ES/sidebar.json',
          'es-ES/changes.json',
          'es-ES/history.json',
          'es-ES/diff.json',
          'es-ES/settings.json'
        ]
      }
    ]
  },

  devtools: { enabled: false }
});
