<script setup lang="ts">
import { toast } from 'vue-sonner';

// Repository settings: a single master switch that overrides the global git
// settings for the active repo. On → identity, signing, SSH key, git target and
// the Conventional Commit composer can be set per-repo (each defaults to
// inheriting the global value). Off → the repo uses the global settings. The
// switch state is stored as `glimpse.override` (local); turning it off clears
// every local override so the repo falls back to global.
const { t } = useI18n();
const repo = useRepoStore();

const override = ref(false);
const activePath = computed(() => repo.active?.path ?? '');

// The local git keys a repo override owns; cleared when the switch goes off.
const LOCAL_KEYS = [
  'user.name',
  'user.email',
  'commit.gpgsign',
  'gpg.format',
  'user.signingkey',
  'glimpse.target',
  'glimpse.conventionalCommits',
  'core.sshCommand'
];

async function load() {
  if (!isTauri() || !activePath.value) return;
  const path = activePath.value;
  try {
    // On = the explicit flag, or any pre-existing local override.
    const [flag, ...vals] = await Promise.all([
      gitClient.getConfig({ path, key: 'glimpse.override', scope: 'local' }),
      ...LOCAL_KEYS.map((key) =>
        gitClient.getConfig({ path, key, scope: 'local' })
      )
    ]);
    override.value = flag === 'true' || vals.some(Boolean);
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
  const path = activePath.value;
  try {
    if (on) {
      await gitClient.setConfig({
        path,
        key: 'glimpse.override',
        value: 'true',
        global: false
      });
    } else {
      // Clear the flag and every local override → fall back to global.
      // Sequential: concurrent writes race on .git/config.lock.
      for (const key of ['glimpse.override', ...LOCAL_KEYS]) {
        await gitClient.unsetConfig({ path, key });
      }
    }
  } catch (e) {
    toast.error(t('settings.repository.override.failed'), {
      description: String(e)
    });
  }
}
</script>

<template>
  <section class="w-full space-y-8">
    <p v-if="!repo.active" class="text-sm text-muted-foreground">
      {{ t('settings.repository.noRepo') }}
    </p>
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

      <p v-if="!override" class="text-sm text-muted-foreground">
        {{ t('settings.repository.usesGlobal') }}
      </p>
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
