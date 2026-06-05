<script setup lang="ts">
// Global git config (applies to every repo, via the active repo's git
// environment): identity, commit signing, SSH keys & credential helper, the git
// target default, and the Conventional Commit composer. Per-repo overrides live
// on the Repository page; fetch/pull behaviour on the General page.
</script>

<template>
  <section class="w-full space-y-8">
    <SettingsGitIdentity scope="global" />
    <SettingsGitSigning scope="global" />
    <SettingsSshCredentials />
    <SettingsGitTarget scope="global" />
    <SettingsConventionalCommits scope="global" />
  </section>
</template>
