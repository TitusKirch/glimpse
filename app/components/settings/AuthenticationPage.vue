<script setup lang="ts">
// Authentication for the active repo's git environment: SSH keys and the
// credential helper. Needs a repo open (the environment is repo-resolved).
const repo = useRepoStore();
const { t } = useI18n();
</script>

<template>
  <section class="w-full space-y-8">
    <p v-if="!repo.active" class="text-sm text-muted-foreground">
      {{ t('settings.authentication.noRepo') }}
    </p>
    <SettingsSshCredentials v-else />
  </section>
</template>
