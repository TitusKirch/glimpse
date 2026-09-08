// The app-wide net under the two failures that otherwise leave nothing but a
// console line: an unhandled promise rejection, and an error Vue could not
// render through. Neither had a handler anywhere in the app, so both were
// invisible to anyone who was not already looking at the inspector.
//
// The two are routed by how much of the app is left standing, not by how they
// were raised:
//
//   * an unhandled rejection is an async call nobody was listening to — the
//     rendered app is intact and still usable, so it gets an error toast and
//     the session continues;
//   * an error out of render, a watcher or an event handler leaves the
//     component tree in an unknown state, so it hands over to the fatal error
//     page, which is the one screen built to be a complete bug report on its own.
//
// A plugin rather than app.vue, for the reason `devtools.client.ts` is one: the
// app shell is exactly what may be broken.
import { toastCollapsedError } from '~/utils/collapsingToast';

export default defineNuxtPlugin((nuxtApp) => {
  // Resolved per event rather than captured: plugin order does not guarantee
  // i18n has been installed yet, and an English fallback is better than a
  // handler that throws while reporting a failure.
  const translate = (key: string, fallback: string) => {
    const i18n = (nuxtApp as { $i18n?: { t: (k: string) => string } }).$i18n;
    try {
      return i18n ? i18n.t(key) : fallback;
    } catch {
      return fallback;
    }
  };

  window.addEventListener('unhandledrejection', (e) => {
    // Claim it: the default action is the browser's own console report, and the
    // toast has now said it better.
    e.preventDefault();
    console.error('unhandled promise rejection:', e.reason);
    // Collapsed like the store's own git errors: a rejection with one cause
    // repeats as fast as whatever raised it, and one toast per repeat is noise.
    toastCollapsedError(
      translate('error.unhandled.title', 'Something went wrong'),
      describeReason(e.reason)
    );
  });

  // Assigned straight onto the Vue app rather than hooked as `vue:error`,
  // because after the initial mount there is nothing left to hook: Nuxt installs
  // its own handler for boot, then clears it again on `app:suspense:resolve`
  // (`nuxt/dist/app/entry.js`), so from the moment the app is usable a render
  // error has no handler at all. Overwriting it here also survives that clear —
  // it only removes the handler while it is still Nuxt's own.
  nuxtApp.vueApp.config.errorHandler = (err) => {
    console.error('vue error:', err);
    // showError() reads the Nuxt app off the running context, and a Vue error
    // handler is not called from inside one.
    nuxtApp.runWithContext(() => showError(err as Error));
  };
});

// A rejection carries anything at all, so read a message off it defensively —
// an Error's own, else whatever it stringifies to.
function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name;
  return String(reason);
}
