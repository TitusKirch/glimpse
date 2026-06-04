<script setup lang="ts">
// Global git config (the active repo's git environment): identity + signing.
// Per-repo overrides live on the Repository page; SSH/credentials on the
// Authentication page; fetch/pull behaviour on the General page.
</script>

<template>
  <section class="w-full space-y-8">
    <SettingsGitIdentity />
    <SettingsGitSigning />
  </section>
</template>
