<script setup lang="ts">
import { toast } from 'vue-sonner';

// Repository settings: a single master switch that overrides the global git
// settings for the active repo. On → identity, signing, SSH key, git target and
// the Conventional Commit composer can be set per-repo (each defaults to
// inheriting the global value). Off → the repo uses the global settings. The
// override policy (which keys, the flag, clearing) lives in useRepoOverride.
const { t } = useI18n();
const repo = useRepoStore();
const ovr = useRepoOverride();

const override = ref(false);
const activePath = computed(() => repo.active?.path ?? '');

async function load() {
  if (!isTauri() || !activePath.value) return;
  try {
    override.value = await ovr.isOverriding();
  } catch (e) {
    toast.error(t('settings.repository.override.failed'), {
      description: String(e)
    });
  }
}

onMounted(load);
watch(activePath, load);

async function toggle(on: boolean) {
  override.value = on;
  if (!isTauri() || !activePath.value) return;
  try {
    if (on) await ovr.enable();
    else await ovr.clear();
  } catch (e) {
    toast.error(t('settings.repository.override.failed'), {
      description: String(e)
    });
  }
}
</script>

<template>
  <section class="w-full space-y-8">
    <UiAlert v-if="!repo.active" variant="info">
      <p class="min-w-0">{{ t('settings.repository.noRepo') }}</p>
    </UiAlert>
    <template v-else>
      <SettingsRow
        label="settings.repository.override.label"
        hint="settings.repository.override.hint"
      >
        <UiSwitch
          :model-value="override"
          class="shrink-0"
          @update:model-value="(v) => toggle(v as boolean)"
        />
      </SettingsRow>

      <UiAlert v-if="!override" variant="info">
        <p class="min-w-0">{{ t('settings.repository.usesGlobal') }}</p>
      </UiAlert>
      <template v-else>
        <SettingsGitIdentity scope="local" />
        <SettingsGitSigning scope="local" />
        <SettingsRepoSshKey />
        <SettingsGitTarget scope="local" />
        <SettingsConventionalCommits scope="local" />
      </template>
    </template>
  </section>
</template>
