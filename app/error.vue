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
import type { BuildKind, Diagnostics } from '~/utils/diagnostics';

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

// The controls have to look like the rest of the app without being the rest of
// the app: importing UiButton/UiSelect would put this page back in the very
// component chunk whose failure brings people here. So the classes are mirrored
// from app/components/ui/button (outline variant) and .../ui/select
// (SelectTrigger), both at the `sm` size, onto plain elements. Copies drift —
// that is the accepted cost, and the reason they sit here as named constants
// rather than being spelt out three times in the template below.
const BUTTON_CLASS =
  'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 ' +
  'whitespace-nowrap rounded-md border bg-background px-3 text-sm font-medium ' +
  'shadow-xs transition-all outline-none hover:bg-accent ' +
  'hover:text-accent-foreground focus-visible:border-ring ' +
  'focus-visible:ring-[3px] focus-visible:ring-ring/50 ' +
  'disabled:pointer-events-none disabled:opacity-50 dark:border-input ' +
  'dark:bg-input/30 dark:hover:bg-input/50';

// `appearance-none` drops the platform arrow (a GTK widget that ignores the
// theme); the chevron beside it in the template replaces it, so pr-8 reserves
// that space. Without it the select is the one control that still announces
// which toolkit drew it.
const SELECT_CLASS =
  'h-8 w-fit cursor-pointer appearance-none rounded-md border border-input ' +
  'bg-transparent py-0 pl-3 pr-8 text-sm shadow-xs ' +
  'transition-[color,box-shadow] outline-none focus-visible:border-ring ' +
  'focus-visible:ring-[3px] focus-visible:ring-ring/50 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 ' +
  'dark:hover:bg-input/50';

const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;

// The facts come from the shared assembly, so the block pasted from a crash and
// the one pasted from Settings → Diagnostics are the same format — but the call
// is defensive, because a broken shared chunk is exactly the failure that brings
// someone here and it could take the composable with it. The fallback is what
// this page computed inline before the extraction; between the two, the report
// renders whatever else is gone.
const facts = (() => {
  try {
    return useDiagnostics();
  } catch {
    return inlineDiagnostics();
  }
})();
const { version, build, os, webview, route } = facts;

function inlineDiagnostics() {
  // Baked in at build time (nuxt.config runtimeConfig) rather than read back
  // from the desktop shell over IPC — the app never got far enough to ask.
  const version = (() => {
    try {
      return String(useRuntimeConfig().public.appVersion || 'unknown');
    } catch {
      return 'unknown';
    }
  })();
  const build: BuildKind = import.meta.dev ? 'dev' : 'release';
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
      const line = formatPluginOs(
        plugin.type(),
        plugin.version(),
        plugin.arch()
      );
      if (line !== 'unknown') os.value = line;
    } catch {
      // Keep the user-agent reading; the page is never blank for want of this.
    }
  }
  return {
    version,
    build,
    os,
    webview,
    route,
    diagnostics: computed<Diagnostics>(() => ({
      version,
      build,
      os: os.value,
      webview,
      route
    }))
  };
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
  ...facts.diagnostics.value,
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

// Recovery: a manual update check, because the automatic one cannot run here.
// The launch check lives in app.vue's onMounted, so a build that fails to boot
// never reaches it — and that is exactly the build this page is showing. Without
// this, a bad release propagates over auto-update and then disables the
// mechanism that would have replaced it (#167).
//
// Deliberately NOT useUpdater(): that needs vue-i18n, the Pinia store and
// vue-sonner, no <Toaster> is mounted on this page, and those are among the
// things that may be part of what broke. Status prints inline instead, and the
// Rust commands are reached the way enrichOs() reaches tauri-plugin-os.
type Channel = 'stable' | 'beta' | 'experiment';

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'stable', label: 'Stable' },
  { value: 'beta', label: 'Beta' },
  { value: 'experiment', label: 'Experiment' }
];

// pinia-plugin-persistedstate keys its blob by the store id and the settings
// store configures no custom key, so this is that store as last written. Read
// directly because instantiating the store is one of the things that may fail.
function persistedSettings(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem('settings');
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// The channel the running build belongs to, read off its version the way
// useUpdater() does. An experiment build is not distinguishable from its version
// alone, so that one case leans on the persisted preference.
function runningChannel(): Channel {
  if (persistedSettings().releaseChannel === 'experiment') return 'experiment';
  return version.includes('-beta.') ? 'beta' : 'stable';
}

const channel = ref<Channel>(
  (() => {
    const stored = persistedSettings().releaseChannel;
    return stored === 'stable' || stored === 'beta' || stored === 'experiment'
      ? stored
      : runningChannel();
  })()
);
const checking = ref(false);
const updateStatus = ref('');
// An installed update only takes effect on a restart, and this page shows
// *because* the running build is broken — so leaving the user on it is the one
// outcome the recovery must not end in. Offered rather than done automatically,
// for the same reason as everywhere else: unfinished work is worth more than the
// seconds saved.
const installed = ref(false);

// Best-effort and never destructive: with no blob there is no settings state to
// amend, and writing one here would hand the recovered app a single-key object
// in place of every other setting it had.
function rememberChannel(next: Channel) {
  try {
    const raw = localStorage.getItem('settings');
    if (!raw) return;
    const blob = JSON.parse(raw);
    if (!blob || typeof blob !== 'object') return;
    blob.releaseChannel = next;
    localStorage.setItem('settings', JSON.stringify(blob));
  } catch {
    // The update still installed; losing the preference is not worth failing on.
  }
}

async function checkForUpdates() {
  if (checking.value) return;
  if (!isTauri()) {
    updateStatus.value = 'Updates are only available in the desktop app.';
    return;
  }
  // An experiment manifest is per-slug and this page cannot list them, so it can
  // only reuse a slug already chosen in Settings.
  const slug = String(persistedSettings().selectedExperiment ?? '');
  const target =
    channel.value === 'experiment'
      ? slug
        ? `experiment:${slug}`
        : ''
      : channel.value;
  if (!target) {
    updateStatus.value =
      'No experiment is selected, so there is no manifest to check. Pick Stable or Beta to get back to a working build.';
    return;
  }
  // Force when moving channel, so the target channel's current build installs
  // even if it is not strictly newer - beta to stable is a deliberate downgrade,
  // and getting off a broken channel is the whole point of this control.
  const force = channel.value !== runningChannel();
  checking.value = true;
  updateStatus.value = 'Checking for updates...';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const available = await invoke<string | null>('check_update', {
      channel: target,
      force
    });
    if (!available) {
      updateStatus.value = `No update available on ${channel.value}.`;
      return;
    }
    updateStatus.value = `Installing ${available}...`;
    await invoke('install_update', { channel: target, force });
    rememberChannel(channel.value);
    installed.value = true;
    updateStatus.value = `Installed ${available}. Restart glimpse to run it.`;
  } catch (err) {
    updateStatus.value = `Update failed: ${String(err)}`;
    console.error('update check failed:', err);
  } finally {
    checking.value = false;
  }
}

// Reached the way enrichOs() reaches tauri-plugin-os: a dynamic import, so a
// broken shared chunk cannot take this page's own render down with it.
async function restart() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('restart_app');
  } catch (err) {
    updateStatus.value = `Restart failed: ${String(err)}. Quit and reopen glimpse to run the installed version.`;
    console.error('restart failed:', err);
  }
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
        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-4 text-xs shadow-xs"
      >
        <template v-for="row in rows" :key="row.label">
          <dt class="text-muted-foreground">{{ row.label }}</dt>
          <dd class="break-all font-mono">{{ row.value }}</dd>
        </template>
      </dl>

      <details v-if="stack" class="rounded-md border shadow-xs">
        <summary
          class="cursor-pointer select-none px-4 py-2 text-sm text-muted-foreground"
        >
          Stack trace
        </summary>
        <pre
          class="overflow-x-auto border-t px-4 py-2 font-mono text-[11px] leading-relaxed"
          >{{ stack }}</pre>
      </details>

      <div class="flex flex-wrap gap-2">
        <button type="button" :class="BUTTON_CLASS" @click="reload">
          Reload
        </button>
        <button type="button" :class="BUTTON_CLASS" @click="copyDiagnostics">
          Copy diagnostics
        </button>
        <button type="button" :class="BUTTON_CLASS" @click="report">
          Report this
        </button>
      </div>

      <div class="space-y-2 rounded-md border p-4 shadow-xs">
        <p class="text-xs text-muted-foreground">
          A broken build cannot update itself: the check that normally runs at
          launch never gets that far. Install a newer build from here, or switch
          channel to get off this one.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <label class="text-sm text-muted-foreground" for="update-channel">
            Channel
          </label>
          <div class="relative inline-flex items-center">
            <select
              id="update-channel"
              v-model="channel"
              :disabled="checking"
              :class="SELECT_CLASS"
            >
              <option v-for="c in CHANNELS" :key="c.value" :value="c.value">
                {{ c.label }}
              </option>
            </select>
            <!-- Inline rather than <NuxtIcon>: the icon component is one more
                 chunk this page refuses to depend on. Drawn on top of the
                 select, so it must not swallow the click that opens it. -->
            <svg
              class="pointer-events-none absolute right-2.5 size-4 opacity-50"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
          <button
            type="button"
            :disabled="checking"
            :class="BUTTON_CLASS"
            @click="checkForUpdates"
          >
            {{ checking ? 'Checking...' : 'Check for updates' }}
          </button>
          <button
            v-if="installed"
            type="button"
            :class="BUTTON_CLASS"
            @click="restart"
          >
            Restart now
          </button>
        </div>
        <p v-if="updateStatus" class="break-words text-xs">
          {{ updateStatus }}
        </p>
      </div>

      <p class="text-xs text-muted-foreground">
        Press F12 to open the developer tools for the full trace.
      </p>
    </div>
  </div>
</template>
