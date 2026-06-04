<script setup lang="ts">
import { toast } from 'vue-sonner';

// Global git identity (~/.gitconfig) — applies to every repository. Read/written
// through the active repo's git, so a WSL repo edits the WSL global config; the
// `· <env>` label names which one. Per-repo overrides live on the Repository
// page.
const { t } = useI18n();
const repo = useRepoStore();

const globalName = ref('');
const globalEmail = ref('');

const env = computed(() => {
  const a = repo.active;
  if (!a) return '';
  return a.flavor === 'wsl' && a.distro ? `WSL · ${a.distro}` : a.flavor;
});

async function routingPath() {
  return repo.active?.path ?? (await gitClient.defaultRepo());
}

async function load() {
  if (!isTauri()) return;
  try {
    const path = await routingPath();
    [globalName.value, globalEmail.value] = await Promise.all([
      gitClient.getConfig({ path, key: 'user.name', global: true }),
      gitClient.getConfig({ path, key: 'user.email', global: true })
    ]);
  } catch (e) {
    toast.error(t('settings.general.gitIdentity.loadFailed'), {
      description: String(e)
    });
  }
}

onMounted(load);
watch(() => repo.active?.path, load);

// Persist on blur. An empty field is left untouched rather than clearing it.
async function save(key: string, value: string) {
  if (!isTauri()) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  try {
    await gitClient.setConfig({
      path: await routingPath(),
      key,
      value: trimmed,
      global: true
    });
  } catch (e) {
    toast.error(t('settings.general.gitIdentity.saveFailed'), {
      description: String(e)
    });
  }
}
</script>

<template>
  <div>
    <h3
      class="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {{ t('settings.general.gitIdentity.section')
      }}<span v-if="env" class="ml-1 normal-case">· {{ env }}</span>
    </h3>
    <p class="mb-3 text-xs text-muted-foreground">
      {{ t('settings.general.gitIdentity.globalHint') }}
    </p>
    <div class="space-y-4">
      <SettingsRow label="settings.general.gitIdentity.name.label">
        <UiInput
          class="w-56 shrink-0"
          :model-value="globalName"
          :placeholder="t('settings.general.gitIdentity.name.placeholder')"
          @input="globalName = ($event.target as HTMLInputElement).value"
          @blur="save('user.name', globalName)"
        />
      </SettingsRow>
      <SettingsRow label="settings.general.gitIdentity.email.label">
        <UiInput
          type="email"
          class="w-56 shrink-0"
          :model-value="globalEmail"
          :placeholder="t('settings.general.gitIdentity.email.placeholder')"
          @input="globalEmail = ($event.target as HTMLInputElement).value"
          @blur="save('user.email', globalEmail)"
        />
      </SettingsRow>
    </div>
  </div>
</template>
