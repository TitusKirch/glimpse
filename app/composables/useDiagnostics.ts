// The diagnostics facts a bug report needs, assembled once for the two surfaces
// that show them: app/error.vue (the fatal error page) and Settings →
// Diagnostics.
//
// It inherits the error page's rules, because that is the harder caller: no
// Pinia store, no i18n, no shadcn component, and IPC only as *optional*
// enrichment that never gates a render. The error page shows precisely because
// something in the app shell broke, so anything reached for here is something
// that can take the bug report down with the app. Keep those rules when adding a
// fact — a fact that needs the app shell belongs on the Diagnostics page's own
// enrichment (channel, experiment, git), not in here.
import type { BuildKind, Diagnostics } from '~/utils/diagnostics';

export function useDiagnostics() {
  // Baked in at build time (nuxt.config runtimeConfig) rather than read back
  // from the desktop shell over IPC — on the error page the app never got far
  // enough to ask.
  const version = (() => {
    try {
      return String(useRuntimeConfig().public.appVersion || 'unknown');
    } catch {
      return 'unknown';
    }
  })();
  const build: BuildKind = import.meta.dev ? 'dev' : 'release';

  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const webview = webviewFromUserAgent(userAgent);
  const route = routeFromLocation(
    typeof window === 'undefined' ? undefined : window.location
  );

  // The user-agent reading shows immediately; tauri-plugin-os replaces it if and
  // when it answers. That goes over IPC, so it is enrichment and never a
  // precondition — if the call never returns, this line simply stays.
  const os = ref(osFromUserAgent(userAgent));
  onMounted(() => void enrichOs());
  async function enrichOs() {
    try {
      if (!isTauri()) return;
      const plugin = await import('@tauri-apps/plugin-os');
      const line = formatPluginOs(
        plugin.type(),
        plugin.version(),
        plugin.arch()
      );
      if (line !== 'unknown') os.value = line;
    } catch {
      // Keep the user-agent reading; neither surface is ever blank for want of
      // this.
    }
  }

  // The shared block. Each caller spreads it and adds what only it can reach —
  // the error page its status/message/stack, the Diagnostics page the facts that
  // need the app shell.
  const diagnostics = computed<Diagnostics>(() => ({
    version,
    build,
    os: os.value,
    webview,
    route
  }));

  return { version, build, os, webview, route, diagnostics };
}
