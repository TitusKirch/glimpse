<script setup lang="ts">
// Nuxt's fatal error page. A screenshot of it has to be a complete bug report on
// its own — version, build kind, OS, WebView, route and stack — because when it
// shows there is nowhere else left in the UI to look those up.
//
// Deliberately assembled from as little as possible: no Pinia store, no Tauri
// IPC and no i18n for the facts it prints, and plain elements rather than the
// shadcn components the rest of the app uses. The failure that brings a user
// here is typically a bundling fault in a shared chunk, and a page built from
// the same pieces would go down with them. The accepted cost is some
// duplication against useAppVersion() and English-only strings on this one page.
import type { Diagnostics } from '~/utils/diagnostics';

const props = defineProps<{
  // Structural rather than Nuxt's NuxtError: one less module to resolve, and
  // the page must render whatever shape it is handed.
  error?: {
    statusCode?: number;
    statusMessage?: string;
    message?: string;
    stack?: string;
  };
}>();

const BUG_REPORT_URL =
  'https://github.com/TitusKirch/glimpse/issues/new?template=bug_report.yml';

// Baked in at build time (nuxt.config runtimeConfig) rather than read back from
// the desktop shell over IPC — the app never got far enough to ask.
const version = (() => {
  try {
    return String(useRuntimeConfig().public.appVersion || 'unknown');
  } catch {
    return 'unknown';
  }
})();
const build = import.meta.dev ? 'dev' : 'release';

const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const webview = webviewFromUserAgent(userAgent);
const route = routeFromLocation(
  typeof window === 'undefined' ? undefined : window.location
);

// The user-agent reading shows immediately; tauri-plugin-os replaces it if and
// when it answers. It goes over IPC, so it is enrichment and never a
// precondition — if the call never returns, this line simply stays.
const os = ref(osFromUserAgent(userAgent));
onMounted(() => void enrichOs());
async function enrichOs() {
  try {
    if (!isTauri()) return;
    const plugin = await import('@tauri-apps/plugin-os');
    const line = formatPluginOs(plugin.type(), plugin.version(), plugin.arch());
    if (line !== 'unknown') os.value = line;
  } catch {
    // Keep the user-agent reading; the page is never blank for want of this.
  }
}

const status = computed(() => {
  const code = props.error?.statusCode;
  if (!code) return undefined;
  return `${code} ${props.error?.statusMessage ?? ''}`.trim();
});
const message = computed(
  () => props.error?.message || props.error?.statusMessage || 'Unknown error'
);
const stack = computed(() => props.error?.stack);

const diagnostics = computed<Diagnostics>(() => ({
  version,
  build,
  os: os.value,
  webview,
  route,
  status: status.value,
  message: message.value,
  stack: stack.value
}));

const rows = computed(() => [
  { label: 'Version', value: `${version} (${build})` },
  { label: 'OS', value: os.value },
  { label: 'WebView', value: webview },
  { label: 'Route', value: route }
]);

// useCopy() resolves the active locale for its success toast, so it needs the
// i18n plugin — one more thing that may be part of what broke. Fall back to a
// bare clipboard write rather than letting the page fail to render.
const copy = (() => {
  try {
    return useCopy();
  } catch {
    return async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        console.error('clipboard write failed:', err);
      }
    };
  }
})();

function copyDiagnostics() {
  void copy(formatDiagnosticsMarkdown(diagnostics.value));
}
function reload() {
  window.location.reload();
}
// Prefills only the template's short "version & OS" field — the rest of the
// block goes over via "Copy diagnostics", because a stack trace in a query
// string is how a link ends up too long to open.
function report() {
  const url = `${BUG_REPORT_URL}&version=${encodeURIComponent(
    `v${version} (${build}) on ${os.value}`
  )}`;
  void openExternal(url);
}
</script>

<template>
  <div
    class="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"
  >
    <div class="w-full max-w-2xl space-y-6">
      <div class="space-y-2">
        <p
          v-if="status"
          class="font-mono text-xs uppercase tracking-wide text-muted-foreground"
        >
          {{ status }}
        </p>
        <h1 class="text-xl font-semibold">glimpse hit a fatal error</h1>
        <p class="break-words text-sm text-muted-foreground">{{ message }}</p>
      </div>

      <dl
        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-4 text-xs"
      >
        <template v-for="row in rows" :key="row.label">
          <dt class="text-muted-foreground">{{ row.label }}</dt>
          <dd class="break-all font-mono">{{ row.value }}</dd>
        </template>
      </dl>

      <details v-if="stack" class="rounded-md border text-xs">
        <summary
          class="cursor-pointer select-none px-4 py-2 text-muted-foreground"
        >
          Stack trace
        </summary>
        <pre
          class="overflow-x-auto border-t px-4 py-2 font-mono text-[11px] leading-relaxed"
          >{{ stack }}</pre>
      </details>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          @click="reload"
        >
          Reload
        </button>
        <button
          type="button"
          class="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          @click="copyDiagnostics"
        >
          Copy diagnostics
        </button>
        <button
          type="button"
          class="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          @click="report"
        >
          Report this
        </button>
      </div>

      <p class="text-xs text-muted-foreground">
        Press F12 to open the developer tools for the full trace.
      </p>
    </div>
  </div>
</template>
