<script setup lang="ts">
const { t } = useI18n();
</script>

<template>
  <!-- Diagnostics: read-only observation of the running app — the diagnostics
       report, the webview inspector, the git/IPC command log, watcher events.
       Nothing here may change how the app behaves; anything that does belongs on
       the Simulation page. The tools themselves land in their own changes. -->
  <EmptyState
    icon="lucide:activity"
    :title="t('settings.diagnostics.empty.title')"
    :description="t('settings.diagnostics.empty.hint')"
  />
</template>
