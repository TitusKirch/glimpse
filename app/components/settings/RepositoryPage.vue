<script setup lang="ts">
// Settings scoped to the active repository: its identity (effective + local
// override) and the per-repo git-target. Needs a repo open.
const repo = useRepoStore();
const { t } = useI18n();
</script>

<template>
  <section class="w-full space-y-8">
    <p v-if="!repo.active" class="text-sm text-muted-foreground">
      {{ t('settings.repository.noRepo') }}
    </p>
    <template v-else>
      <SettingsRepoIdentity />
      <SettingsGitTarget />
    </template>
  </section>
</template>
