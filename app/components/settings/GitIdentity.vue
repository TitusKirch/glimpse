<script setup lang="ts">
import { toast } from 'vue-sonner';

// Git identity (user.name / user.email) at a given scope. `global` edits
// ~/.gitconfig (applies to every repo); `local` edits this repo's .git/config —
// an override, where an empty field clears it so the global value is inherited.
// Read & written through the active repo's git, so a WSL repo edits the WSL
// config; the `· <env>` label names which one.
const props = withDefaults(defineProps<{ scope?: 'global' | 'local' }>(), {
  scope: 'global'
});
const { t } = useI18n();
const repo = useRepoStore();

const name = ref('');
const email = ref('');

const isGlobal = computed(() => props.scope === 'global');
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
    [name.value, email.value] = await Promise.all([
      gitClient.getConfig({ path, key: 'user.name', scope: props.scope }),
      gitClient.getConfig({ path, key: 'user.email', scope: props.scope })
    ]);
  } catch (e) {
    toast.error(t('settings.general.gitIdentity.loadFailed'), {
      description: String(e)
    });
  }
}

onMounted(load);
watch([() => repo.active?.path, () => props.scope], load);

// global: an empty field is left untouched (never wipe the global identity).
// local: an empty field clears the override so the global value is inherited.
async function save(key: string, value: string) {
  if (!isTauri()) return;
  const trimmed = value.trim();
  try {
    const path = await routingPath();
    if (!trimmed) {
      if (!isGlobal.value) await gitClient.unsetConfig({ path, key });
      return;
    }
    await gitClient.setConfig({
      path,
      key,
      value: trimmed,
      global: isGlobal.value
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
      }}<span v-if="isGlobal && env" class="ml-1 normal-case">· {{ env }}</span>
    </h3>
    <p class="mb-3 text-xs text-muted-foreground">
      {{
        t(
          isGlobal
            ? 'settings.general.gitIdentity.globalHint'
            : 'settings.general.gitIdentity.localHint'
        )
      }}
    </p>
    <div class="space-y-4">
      <SettingsRow label="settings.general.gitIdentity.name.label">
        <UiInput
          class="w-56 shrink-0"
          :model-value="name"
          :placeholder="t('settings.general.gitIdentity.name.placeholder')"
          @input="name = ($event.target as HTMLInputElement).value"
          @blur="save('user.name', name)"
        />
      </SettingsRow>
      <SettingsRow label="settings.general.gitIdentity.email.label">
        <UiInput
          type="email"
          class="w-56 shrink-0"
          :model-value="email"
          :placeholder="t('settings.general.gitIdentity.email.placeholder')"
          @input="email = ($event.target as HTMLInputElement).value"
          @blur="save('user.email', email)"
        />
      </SettingsRow>
    </div>
  </div>
</template>
