import tailwindcss from '@tailwindcss/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-05-30',

  // Desktop app: single-page, no server rendering.
  ssr: false,

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
    serverBundle: {
      collections: ['flag', 'lucide', 'simple-icons']
    }
  },

  css: ['~/assets/css/tailwind.css', 'vue-sonner/style.css'],

  vite: {
    plugins: [tailwindcss()],
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
        '@tauri-apps/plugin-deep-link',
        '@tauri-apps/plugin-updater',
        '@tanstack/vue-virtual',
        '@vueuse/core',
        'class-variance-authority',
        'clsx',
        'highlight.js',
        'reka-ui',
        'tailwind-merge',
        'vue-sonner'
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
    fallbackLocale: 'en-GB',
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
