<script setup lang="ts">
import { toast } from 'vue-sonner';

// Git target (`glimpse.target`) at a given scope, honoured by platform::resolve().
// `global` is the default for every repo (Auto = automatic per-repo detection,
// Native = force the host git, Custom = an explicit git binary). `local` is a
// per-repo override (Inherit = use the global default; Native / Custom force this
// repo). The resolved banner (which git actually runs) is shown for a repo.
const props = withDefaults(defineProps<{ scope?: 'global' | 'local' }>(), {
  scope: 'global'
});
const { t } = useI18n();
const repo = useRepoStore();

const isGlobal = computed(() => props.scope === 'global');
// global's "no override" is Auto; local's is Inherit.
const baseMode = computed(() => (isGlobal.value ? 'auto' : 'inherit'));

const mode = ref<'auto' | 'inherit' | 'native' | 'custom'>('auto');
const customPath = ref('');
const distros = ref<string[]>([]);

const activePath = computed(() => repo.active?.path ?? '');
// A human label for the git that currently runs for this repo.
const resolved = computed(() => {
  const a = repo.active;
  if (!a) return '';
  if (a.flavor === 'wsl' && a.distro) return `WSL · ${a.distro}`;
  const os =
    a.flavor === 'macos'
      ? 'macOS'
      : a.flavor === 'windows'
        ? 'Windows'
        : 'Linux';
  return `${t('settings.general.gitTarget.nativeGit')} (${os})`;
});

async function routingPath() {
  return repo.active?.path ?? (await gitClient.defaultRepo());
}

async function load() {
  if (!isTauri()) return;
  mode.value = baseMode.value;
  distros.value = await gitClient.wslDistros();
  const v = await gitClient.getConfig({
    path: await routingPath(),
    key: 'glimpse.target',
    scope: props.scope
  });
  if (v === 'native') mode.value = 'native';
  else if (v && v !== 'auto') {
    mode.value = 'custom';
    customPath.value = v;
  } else mode.value = baseMode.value;
}

onMounted(load);
watch([() => repo.active?.path, () => props.scope], load);

async function save() {
  if (!isTauri()) return;
  try {
    const path = await routingPath();
    // The "no override" choice clears the value (global → automatic; local →
    // inherit the global default).
    if (mode.value === 'auto' || mode.value === 'inherit') {
      await gitClient.unsetConfig({
        path,
        key: 'glimpse.target',
        scope: props.scope
      });
      return;
    }
    const value = mode.value === 'custom' ? customPath.value.trim() : 'native';
    if (!value) return;
    await gitClient.setConfig({
      path,
      key: 'glimpse.target',
      value,
      global: isGlobal.value
    });
  } catch (e) {
    toast.error(t('settings.general.gitTarget.saveFailed'), {
      description: String(e)
    });
  }
}

function setMode(v: string) {
  mode.value = v as typeof mode.value;
  if (v !== 'custom') void save();
}
</script>

<template>
  <div>
    <h3
      class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {{ t('settings.general.gitTarget.section') }}
    </h3>
    <div class="space-y-4">
      <SettingsRow
        label="settings.general.gitTarget.mode.label"
        hint="settings.general.gitTarget.mode.hint"
      >
        <UiSelect
          :model-value="mode"
          @update:model-value="(v) => setMode(v as string)"
        >
          <UiSelectTrigger class="w-44 shrink-0">
            <UiSelectValue />
          </UiSelectTrigger>
          <UiSelectContent>
            <UiSelectItem v-if="isGlobal" value="auto">
              {{ t('settings.general.gitTarget.auto') }}
            </UiSelectItem>
            <UiSelectItem v-else value="inherit">
              {{ t('settings.general.override.inherit') }}
            </UiSelectItem>
            <UiSelectItem value="native">
              {{ t('settings.general.gitTarget.native') }}
            </UiSelectItem>
            <UiSelectItem value="custom">
              {{ t('settings.general.gitTarget.custom') }}
            </UiSelectItem>
          </UiSelectContent>
        </UiSelect>
      </SettingsRow>
      <SettingsRow
        v-if="mode === 'custom'"
        label="settings.general.gitTarget.path.label"
        hint="settings.general.gitTarget.path.hint"
      >
        <UiInput
          class="w-56 shrink-0"
          :model-value="customPath"
          :placeholder="t('settings.general.gitTarget.path.placeholder')"
          @input="customPath = ($event.target as HTMLInputElement).value"
          @blur="save"
        />
      </SettingsRow>
      <!-- which git actually runs for this repo (only meaningful with a repo) -->
      <UiAlert v-if="!isGlobal && activePath" variant="info">
        <p class="min-w-0">
          {{ t('settings.general.gitTarget.resolved', { target: resolved }) }}
          <template v-if="distros.length">
            ·
            {{
              t('settings.general.gitTarget.distros', {
                list: distros.join(', ')
              })
            }}
          </template>
        </p>
      </UiAlert>
    </div>
  </div>
</template>
