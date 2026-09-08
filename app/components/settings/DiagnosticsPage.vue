<script setup lang="ts">
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

// The pasted block is the same format the fatal error page produces, minus the
// error lines there is nothing to say about.
const copy = useCopy();
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
