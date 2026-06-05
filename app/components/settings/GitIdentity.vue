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
const cfg = useGitConfig();

const name = ref('');
const email = ref('');

const isGlobal = computed(() => props.scope === 'global');
const env = computed(() => {
  const a = repo.active;
  if (!a) return '';
  return a.flavor === 'wsl' && a.distro ? `WSL · ${a.distro}` : a.flavor;
});

async function load() {
  if (!isTauri()) return;
  try {
    [name.value, email.value] = await Promise.all([
      cfg.read('user.name', props.scope),
      cfg.read('user.email', props.scope)
    ]);
  } catch (e) {
    toast.error(t('settings.general.gitIdentity.loadFailed'), {
      description: String(e)
    });
  }
}

onMounted(load);
watch([() => repo.active?.path, () => props.scope], load);

// cfg.write owns the inherit rule: at local scope an empty field clears the
// override; at global scope an empty field is left untouched.
async function save(key: string, value: string) {
  if (!isTauri()) return;
  try {
    await cfg.write(key, value, props.scope);
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
