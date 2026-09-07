// F12 opens the webview inspector — in release builds too, not just in dev
// (the `devtools` feature on the `tauri` dependency is what keeps it compiled
// in). glimpse is MIT-licensed with public source, so there is nothing to
// withhold, and someone filing a bug reaches the real stack trace without first
// being told a magic environment variable.
//
// A plugin rather than useShortcuts(): those are wired from app.vue, so a fatal
// error that never gets the app shell mounted would take the shortcut with it —
// which is exactly the situation the inspector is wanted in.
export default defineNuxtPlugin(() => {
  // In the browser dev demo F12 is the browser's own devtools; leave it alone.
  if (!isTauri()) return;
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'F12') return;
    e.preventDefault();
    void tauriInvoke<null>({ command: 'open_devtools', fallback: null }).catch(
      () => {}
    );
  });
});
