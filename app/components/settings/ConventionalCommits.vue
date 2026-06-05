<script setup lang="ts">
import { toast } from 'vue-sonner';

// Conventional Commit composer toggle (`glimpse.conventionalCommits`) at a given
// scope. `global` is a plain on/off default; `local` is a per-repo override
// (Inherit / On / Off). Stored in git config so it follows the same global +
// per-repo model as the other git settings; the commit box reads the effective
// value.
const props = withDefaults(defineProps<{ scope?: 'global' | 'local' }>(), {
  scope: 'global'
});
const { t } = useI18n();
const repo = useRepoStore();

const isGlobal = computed(() => props.scope === 'global');
const enabled = ref(false); // global on/off
const mode = ref<'inherit' | 'on' | 'off'>('inherit'); // local tri-state
// Shared effective state so the commit box reflects a change here immediately.
const cc = useConventionalCommits();

async function routingPath() {
  return repo.active?.path ?? (await gitClient.defaultRepo());
}

async function load() {
  if (!isTauri()) return;
  try {
    const v = await gitClient.getConfig({
      path: await routingPath(),
      key: 'glimpse.conventionalCommits',
      scope: props.scope
    });
    if (isGlobal.value) enabled.value = v === 'true';
    else mode.value = v === 'true' ? 'on' : v ? 'off' : 'inherit';
  } catch (e) {
    toast.error(t('settings.general.conventional.loadFailed'), {
      description: String(e)
    });
  }
}

onMounted(load);
watch([() => repo.active?.path, () => props.scope], load);

function fail(e: unknown) {
  toast.error(t('settings.general.conventional.saveFailed'), {
    description: String(e)
  });
}

async function toggle(on: boolean) {
  enabled.value = on;
  cc.enabled.value = on; // optimistic — the commit box reacts at once
  try {
    await gitClient.setConfig({
      path: await routingPath(),
      key: 'glimpse.conventionalCommits',
      value: on ? 'true' : 'false',
      global: true
    });
    await cc.load();
  } catch (e) {
    fail(e);
  }
}

async function setMode(v: 'inherit' | 'on' | 'off') {
  mode.value = v;
  try {
    const path = await routingPath();
    if (v === 'inherit') {
      await gitClient.unsetConfig({ path, key: 'glimpse.conventionalCommits' });
    } else {
      await gitClient.setConfig({
        path,
        key: 'glimpse.conventionalCommits',
        value: v === 'on' ? 'true' : 'false',
        global: false
      });
    }
    await cc.load();
  } catch (e) {
    fail(e);
  }
}
</script>

<template>
  <div>
    <h3
      class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {{ t('settings.general.conventional.section') }}
    </h3>
    <div class="space-y-4">
      <SettingsRow
        label="settings.general.conventional.enable.label"
        hint="settings.general.conventional.enable.hint"
      >
        <UiSwitch
          v-if="isGlobal"
          :model-value="enabled"
          class="shrink-0"
          @update:model-value="(v) => toggle(v as boolean)"
        />
        <UiSelect
          v-else
          :model-value="mode"
          @update:model-value="(v) => setMode(v as 'inherit' | 'on' | 'off')"
        >
          <UiSelectTrigger class="w-44 shrink-0">
            <UiSelectValue />
          </UiSelectTrigger>
          <UiSelectContent>
            <UiSelectItem value="inherit">
              {{ t('settings.general.override.inherit') }}
            </UiSelectItem>
            <UiSelectItem value="on">
              {{ t('settings.general.override.on') }}
            </UiSelectItem>
            <UiSelectItem value="off">
              {{ t('settings.general.override.off') }}
            </UiSelectItem>
          </UiSelectContent>
        </UiSelect>
      </SettingsRow>
    </div>
  </div>
</template>
