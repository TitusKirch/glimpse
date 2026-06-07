<script setup lang="ts">
// Global git config (applies to every repo, via the active repo's git
// environment): identity, commit signing, SSH keys & credential helper, the git
// target default, and the Conventional Commit composer — plus the changelists
// view toggle (a commit-workflow preference). Per-repo overrides live on the
// Repository page; fetch/pull behaviour on the General page.
const settings = useSettingsStore();
const { t } = useI18n();
</script>

<template>
  <section class="w-full space-y-8">
    <SettingsGitIdentity scope="global" />
    <SettingsGitSigning scope="global" />
    <SettingsSshCredentials />
    <SettingsGitTarget scope="global" />
    <SettingsConventionalCommits scope="global" />

    <div>
      <h3
        class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {{ t('settings.general.changelists.section') }}
      </h3>
      <div class="space-y-4">
        <SettingsRow
          label="settings.general.changelists.label"
          hint="settings.general.changelists.hint"
        >
          <UiSwitch
            :model-value="settings.changelists"
            class="shrink-0"
            @update:model-value="(v) => (settings.changelists = v as boolean)"
          />
        </SettingsRow>
      </div>
    </div>
  </section>
</template>
