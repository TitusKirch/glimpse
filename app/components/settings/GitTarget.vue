<script setup lang="ts">
import { toast } from 'vue-sonner';

// Per-repo git target override, stored as `glimpse.target` in the repo's local
// git config and honoured by platform::resolve(): Auto (path-based), Native
// (force the host git, even for a \\wsl$ repo) or a Custom git binary path.
// Shows the resolved target and any detected WSL distros for context.
const { t } = useI18n();
const repo = useRepoStore();

const mode = ref<'auto' | 'native' | 'custom'>('auto');
const customPath = ref('');
const distros = ref<string[]>([]);

const activePath = computed(() => repo.active?.path ?? '');
const hasRepo = computed(() => !!activePath.value);
const resolved = computed(() => {
  const a = repo.active;
  if (!a) return '';
  return a.flavor === 'wsl' && a.distro ? `WSL · ${a.distro}` : a.flavor;
});

async function load() {
  if (!isTauri() || !hasRepo.value) return;
  distros.value = await gitClient.wslDistros();
  const v = await gitClient.getConfig({
    path: activePath.value,
    key: 'glimpse.target',
    global: false
  });
  if (v === 'native') mode.value = 'native';
  else if (v && v !== 'auto') {
    mode.value = 'custom';
    customPath.value = v;
  } else mode.value = 'auto';
}

onMounted(load);
watch(activePath, load);

async function save() {
  if (!isTauri() || !hasRepo.value) return;
  const value = mode.value === 'custom' ? customPath.value.trim() : mode.value;
  if (!value) return;
  try {
    await gitClient.setConfig({
      path: activePath.value,
      key: 'glimpse.target',
      value,
      global: false
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
  <div v-if="hasRepo">
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
            <UiSelectItem value="auto">
              {{ t('settings.general.gitTarget.auto') }}
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
      <p class="text-xs text-muted-foreground">
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
    </div>
  </div>
</template>
