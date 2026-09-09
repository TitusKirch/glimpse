// vue-i18n *runtime* options. This is the only place that switches on
// lookup-time fallback: when a key is missing in the active locale, vue-i18n
// substitutes it from the chain here. Without this file vue-i18n defaults to
// `fallbackLocale: false` and a missing fr-FR/es-ES key shows nothing instead
// of the en-GB text. @nuxtjs/i18n v10 has no module-level counterpart, so this
// chain has no twin in nuxt.config to keep in step with.
export default defineI18nConfig(() => ({
  fallbackLocale: {
    'de-DE': ['en-GB'],
    'fr-FR': ['en-GB'],
    'es-ES': ['en-GB'],
    default: ['en-GB']
  },
  // fr-FR / es-ES are intentionally partial, so a missing key falling back to
  // en-GB is the expected path, not an error. vue-i18n otherwise logs a warning
  // for every locale it walks on the way to the fallback (`fr-FR` → `fr` →
  // en-GB), flooding the dev console. These are dev-only warnings; silence them
  // so a genuinely-broken en-GB key isn't lost in the noise. Flip back on when
  // auditing translation coverage.
  missingWarn: false,
  fallbackWarn: false
}));
