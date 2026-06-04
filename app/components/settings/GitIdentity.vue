<script setup lang="ts">
import { toast } from 'vue-sonner';

// Git identity lives in git config, not the settings store, so this section
// reads and writes it directly. Calls route through the active repo (so a WSL
// repo hits the right git); global config falls back to routing through the
// process CWD when no repo is open — it is global either way.
const { t } = useI18n();
const repo = useRepoStore();

const globalName = ref('');
const globalEmail = ref('');
const localName = ref('');
const localEmail = ref('');

const activePath = computed(() => repo.active?.path ?? '');
const hasRepo = computed(() => !!activePath.value);

async function routingPath() {
  return activePath.value || (await gitClient.defaultRepo());
}

async function load() {
  if (!isTauri()) return;
  try {
    const path = await routingPath();
    [globalName.value, globalEmail.value] = await Promise.all([
      gitClient.getConfig({ path, key: 'user.name', global: true }),
      gitClient.getConfig({ path, key: 'user.email', global: true })
    ]);
    if (hasRepo.value) {
      [localName.value, localEmail.value] = await Promise.all([
        gitClient.getConfig({
          path: activePath.value,
          key: 'user.name',
          global: false
        }),
        gitClient.getConfig({
          path: activePath.value,
          key: 'user.email',
          global: false
        })
      ]);
    }
  } catch (e) {
    toast.error(t('settings.general.gitIdentity.loadFailed'), {
      description: String(e)
    });
  }
}

onMounted(load);

// Persist on blur. An empty field is left untouched rather than clearing the
// configured value.
async function save(key: string, value: string, global: boolean) {
  if (!isTauri()) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  try {
    const path = global ? await routingPath() : activePath.value;
    await gitClient.setConfig({ path, key, value: trimmed, global });
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
      class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {{ t('settings.general.gitIdentity.section') }}
    </h3>
    <div class="space-y-4">
      <SettingsRow
        label="settings.general.gitIdentity.name.label"
        hint="settings.general.gitIdentity.globalHint"
      >
        <UiInput
          class="w-56 shrink-0"
          :model-value="globalName"
          :placeholder="t('settings.general.gitIdentity.name.placeholder')"
          @input="globalName = ($event.target as HTMLInputElement).value"
          @blur="save('user.name', globalName, true)"
        />
      </SettingsRow>
      <SettingsRow label="settings.general.gitIdentity.email.label">
        <UiInput
          type="email"
          class="w-56 shrink-0"
          :model-value="globalEmail"
          :placeholder="t('settings.general.gitIdentity.email.placeholder')"
          @input="globalEmail = ($event.target as HTMLInputElement).value"
          @blur="save('user.email', globalEmail, true)"
        />
      </SettingsRow>
    </div>

    <!-- Optional per-repository override (local git config), only when a repo
         is open. -->
    <template v-if="hasRepo">
      <h4 class="mt-6 mb-3 text-xs font-medium text-muted-foreground">
        {{ t('settings.general.gitIdentity.overrideSection') }}
      </h4>
      <div class="space-y-4">
        <SettingsRow
          label="settings.general.gitIdentity.name.label"
          hint="settings.general.gitIdentity.overrideHint"
        >
          <UiInput
            class="w-56 shrink-0"
            :model-value="localName"
            :placeholder="t('settings.general.gitIdentity.name.placeholder')"
            @input="localName = ($event.target as HTMLInputElement).value"
            @blur="save('user.name', localName, false)"
          />
        </SettingsRow>
        <SettingsRow label="settings.general.gitIdentity.email.label">
          <UiInput
            type="email"
            class="w-56 shrink-0"
            :model-value="localEmail"
            :placeholder="t('settings.general.gitIdentity.email.placeholder')"
            @input="localEmail = ($event.target as HTMLInputElement).value"
            @blur="save('user.email', localEmail, false)"
          />
        </SettingsRow>
      </div>
    </template>
  </div>
</template>
