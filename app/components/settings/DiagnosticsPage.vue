<script setup lang="ts">
import type { GitCommandEntry } from '~/types/bindings';

const { t } = useI18n();

// The same facts the fatal error page assembles, from the same place — so the
// block someone pastes from here and the block they paste from a crash are the
// one format, and a reader never has to work out which they were handed.
const { diagnostics: facts } = useDiagnostics();

// Which channel the running build belongs to, inferred from the build itself the
// way useUpdater() infers it — the build's identity, deliberately not the
// channel preference someone has since selected in Settings.
const { experiment, isExperiment, isBeta } = useAppVersion();
const channel = computed(() =>
  isExperiment.value ? 'experiment' : isBeta.value ? 'beta' : 'stable'
);

// The git environment: which git runs for the repo on screen, and what it
// answers to `--version`. Enrichment over IPC — the page renders from the facts
// that need none, and simply has no Git line until (or unless) this answers.
const repo = useRepoStore();
const git = ref('');
const gitTarget = computed(() =>
  formatGitTarget(repo.active?.flavor ?? '', repo.active?.distro)
);
onMounted(async () => {
  // No repo open is not an error: an empty path reports the plain native git,
  // which is the honest answer for an app that has not opened one.
  git.value = await gitClient.gitVersion(repo.active?.path ?? '');
});

const rows = computed(() =>
  [
    { key: 'version', value: `${facts.value.version} (${facts.value.build})` },
    { key: 'channel', value: channel.value },
    { key: 'experiment', value: experiment.value ?? '' },
    { key: 'os', value: facts.value.os },
    { key: 'webview', value: facts.value.webview },
    { key: 'git', value: git.value },
    {
      key: 'gitTarget',
      // "unknown" is what the formatter says when no repo has resolved a target;
      // an absent row says that better than a row saying nothing.
      value: gitTarget.value === 'unknown' ? '' : gitTarget.value
    },
    { key: 'route', value: facts.value.route }
  ].filter((r) => !!r.value)
);

// The git calls this session made. Recorded in the backend from process start —
// the only place that can see a git call at all, since one IPC call is not one
// git call and a mis-routed git target is invisible from this side — and kept
// there in memory only, capped, never written to disk. Read on demand: the
// buffer only grows behind this page, so a snapshot plus a refresh beats a poll
// that would itself be noise in what it is reporting on.
const commandLog = ref<GitCommandEntry[]>([]);
const loadingLog = ref(false);
// Newest first — the call someone is asking about is the one that just ran —
// and already formatted, so the rendered row is a straight read.
const recentCalls = computed(() =>
  [...commandLog.value]
    .reverse()
    // `ms` is the SI symbol, the same in every locale glimpse ships — a
    // translation key for it would only be a key to keep in step.
    .map((call) => ({
      ...call,
      time: formatCommandTime(call.at),
      duration: `${call.durationMs} ms`
    }))
);

// A plain substring filter over the two things a reader searches for: the
// invocation itself and git's own message on a failure. Nothing fuzzy — the
// point is to find `fetch` or a path among a few hundred near-identical lines.
const logQuery = ref('');
const visibleCalls = computed(() => {
  const q = logQuery.value.trim().toLowerCase();
  if (!q) return recentCalls.value;
  return recentCalls.value.filter(
    (call) =>
      call.command.toLowerCase().includes(q) ||
      call.error.toLowerCase().includes(q)
  );
});
async function refreshLog() {
  loadingLog.value = true;
  try {
    commandLog.value = await gitClient.gitCommandLog();
  } finally {
    loadingLog.value = false;
  }
}
onMounted(refreshLog);

// The pasted block is the same format the fatal error page produces, minus the
// error lines there is nothing to say about.
const copy = useCopy();
// Its own block, copied separately: the report is the handful of facts every
// issue wants, while the log is bulk someone is asked for once the report has
// not explained it.
function copyCommandLog() {
  void copy(formatCommandLogMarkdown(commandLog.value));
}
function copyDiagnostics() {
  void copy(
    formatDiagnosticsMarkdown({
      ...facts.value,
      channel: channel.value,
      experiment: experiment.value ?? undefined,
      git: git.value || undefined,
      gitTarget: gitTarget.value === 'unknown' ? undefined : gitTarget.value
    })
  );
}

// The webview inspector — the console, the network log and the full stack trace.
// F12 opens it from anywhere in the app (app/plugins/devtools.client.ts); this
// is the same command, made discoverable. Only the desktop shell has one: in the
// browser demo F12 is the browser's own devtools and this command has nothing to
// open.
const desktop = isTauri();
function openInspector() {
  void tauriInvoke<null>({ command: 'open_devtools', fallback: null });
}
</script>

<template>
  <!-- Diagnostics: read-only observation of the running app. Nothing here may
       change how the app behaves; anything that does belongs on the Simulation
       page. -->
  <section class="w-full space-y-8">
    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.diagnostics.report.label') }}
      </h3>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t('settings.diagnostics.report.hint') }}
      </p>
      <dl
        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-4 text-xs"
      >
        <template v-for="row in rows" :key="row.key">
          <dt class="text-muted-foreground">
            {{ t(`settings.diagnostics.rows.${row.key}`) }}
          </dt>
          <dd class="break-all font-mono">{{ row.value }}</dd>
        </template>
      </dl>
      <UiButton
        class="mt-3"
        variant="outline"
        size="sm"
        icon="lucide:clipboard-copy"
        @click="copyDiagnostics"
      >
        {{ t('settings.diagnostics.report.copy') }}
      </UiButton>
    </div>

    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.diagnostics.commandLog.label') }}
      </h3>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t('settings.diagnostics.commandLog.hint') }}
      </p>
      <div class="mb-3 flex flex-wrap gap-2">
        <UiButton
          variant="outline"
          size="sm"
          icon="lucide:refresh-cw"
          :disabled="loadingLog"
          @click="refreshLog"
        >
          {{ t('settings.diagnostics.commandLog.refresh') }}
        </UiButton>
        <UiButton
          variant="outline"
          size="sm"
          icon="lucide:clipboard-copy"
          :disabled="!commandLog.length"
          @click="copyCommandLog"
        >
          {{ t('settings.diagnostics.commandLog.copy') }}
        </UiButton>
      </div>
      <UiInput
        v-if="recentCalls.length"
        v-model="logQuery"
        class="mb-3 h-8 font-mono text-xs"
        type="search"
        :placeholder="t('settings.diagnostics.commandLog.search')"
      />
      <p v-if="!recentCalls.length" class="text-xs text-muted-foreground">
        {{ t('settings.diagnostics.commandLog.empty') }}
      </p>
      <p v-else-if="!visibleCalls.length" class="text-xs text-muted-foreground">
        {{ t('settings.diagnostics.commandLog.noMatches') }}
      </p>
      <!-- Time over duration in one fixed-width column, the command beside it:
           the timestamps line up down the page, so the eye scans the calls
           rather than re-finding where each one starts. -->
      <ol
        v-else
        class="max-h-80 divide-y overflow-y-auto rounded-md border text-xs"
      >
        <li
          v-for="call in visibleCalls"
          :key="call.seq"
          class="call grid grid-cols-[6.5rem_1fr] gap-x-3 px-3 py-2"
        >
          <div class="font-mono text-[11px] leading-snug tabular-nums">
            <div class="text-muted-foreground">{{ call.time }}</div>
            <div
              :class="call.ok ? 'text-muted-foreground' : 'text-destructive'"
            >
              {{ call.duration }}
            </div>
          </div>
          <div class="min-w-0">
            <p class="break-all font-mono leading-snug">{{ call.command }}</p>
            <p v-if="call.error" class="mt-1 break-all text-destructive">
              {{ call.error }}
            </p>
          </div>
        </li>
      </ol>
    </div>

    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.diagnostics.inspector.label') }}
      </h3>
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t('settings.diagnostics.inspector.hint') }}
      </p>
      <UiButton
        variant="outline"
        size="sm"
        icon="lucide:bug"
        :disabled="!desktop"
        @click="openInspector"
      >
        {{ t('settings.diagnostics.inspector.open') }}
      </UiButton>
    </div>
  </section>
</template>
