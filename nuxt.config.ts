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

  css: ['~/assets/css/tailwind.css'],

  vite: {
    plugins: [tailwindcss()],
    // Tauri expects a fixed dev server; fail loudly instead of hopping ports.
    clearScreen: false,
    server: { strictPort: true },
    // Pre-bundle these so Vite doesn't re-optimize mid-load and force a reload
    // (which can leave the Tauri webview on a blank/black screen).
    optimizeDeps: {
      include: [
        '@tauri-apps/api/core',
        '@vueuse/core',
        'class-variance-authority',
        'clsx',
        'highlight.js',
        'reka-ui',
        'tailwind-merge'
      ]
    }
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
    defaultLocale: 'en',
    strategy: 'no_prefix',
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'de', name: 'Deutsch', file: 'de.json' }
    ]
  },

  devtools: { enabled: false }
});
