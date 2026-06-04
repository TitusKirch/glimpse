<script setup lang="ts">
import { toast } from 'vue-sonner';

// Per-repository identity: the effective value the next commit here will use
// (config resolved with no scope → system → global → local), plus a local
// (`.git/config`) override. Only rendered with a repo open.
const { t } = useI18n();
const repo = useRepoStore();

const localName = ref('');
const localEmail = ref('');
const effectiveName = ref('');
const effectiveEmail = ref('');

const activePath = computed(() => repo.active?.path ?? '');
const missing = computed(() => !effectiveName.value || !effectiveEmail.value);

async function load() {
  if (!isTauri() || !activePath.value) return;
  try {
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
    effectiveName.value = localName.value;
    effectiveEmail.value = localEmail.value;
  } catch (e) {
    toast.error(t('settings.general.gitIdentity.loadFailed'), {
      description: String(e)
    });
  }
}

onMounted(load);
watch(activePath, load);

async function save(key: string, value: string) {
  if (!isTauri() || !activePath.value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  try {
    await gitClient.setConfig({
      path: activePath.value,
      key,
      value: trimmed,
      global: false
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
      class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {{ t('settings.general.gitIdentity.section') }}
    </h3>

    <!-- what the next commit in this repo will actually use -->
    <div
      class="mb-5 rounded-md border px-3 py-2 text-sm"
      :class="
        missing
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'text-muted-foreground'
      "
    >
      <template v-if="missing">
        <NuxtIcon name="lucide:triangle-alert" class="mr-1 inline size-4" />
        {{ t('settings.general.gitIdentity.effectiveMissing') }}
      </template>
      <template v-else>
        {{ t('settings.general.gitIdentity.effective') }}
        <span class="font-medium text-foreground"
          >{{ effectiveName }} &lt;{{ effectiveEmail }}&gt;</span
        >
      </template>
    </div>

    <h4 class="mb-1 text-sm font-medium">
      {{ t('settings.general.gitIdentity.overrideSection') }}
    </h4>
    <p class="mb-3 text-xs text-muted-foreground">
      {{ t('settings.general.gitIdentity.overrideHint') }}
    </p>
    <div class="space-y-4">
      <SettingsRow label="settings.general.gitIdentity.name.label">
        <UiInput
          class="w-56 shrink-0"
          :model-value="localName"
          :placeholder="t('settings.general.gitIdentity.name.placeholder')"
          @input="localName = ($event.target as HTMLInputElement).value"
          @blur="save('user.name', localName)"
        />
      </SettingsRow>
      <SettingsRow label="settings.general.gitIdentity.email.label">
        <UiInput
          type="email"
          class="w-56 shrink-0"
          :model-value="localEmail"
          :placeholder="t('settings.general.gitIdentity.email.placeholder')"
          @input="localEmail = ($event.target as HTMLInputElement).value"
          @blur="save('user.email', localEmail)"
        />
      </SettingsRow>
    </div>
  </div>
</template>
