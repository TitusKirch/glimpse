<script setup lang="ts">
import { toast } from 'vue-sonner';

// Per-repository identity: an info banner with the effective value the next
// commit here will use, plus a toggle-gated local (`.git/config`) override.
// Turning the override off drops the local keys so it falls back to the
// inherited (global) identity. Only rendered with a repo open.
const { t } = useI18n();
const repo = useRepoStore();

const localName = ref('');
const localEmail = ref('');
const effectiveName = ref('');
const effectiveEmail = ref('');
const override = ref(false);

const activePath = computed(() => repo.active?.path ?? '');
const missing = computed(() => !effectiveName.value || !effectiveEmail.value);

async function load() {
  if (!isTauri() || !activePath.value) return;
  const path = activePath.value;
  try {
    // Banner = effective (after precedence); the fields show the *local-only*
    // override, so they stay empty when nothing overrides the inherited value.
    const [effN, effE, locN, locE] = await Promise.all([
      gitClient.getConfig({ path, key: 'user.name', scope: '' }),
      gitClient.getConfig({ path, key: 'user.email', scope: '' }),
      gitClient.getConfig({ path, key: 'user.name', scope: 'local' }),
      gitClient.getConfig({ path, key: 'user.email', scope: 'local' })
    ]);
    effectiveName.value = effN;
    effectiveEmail.value = effE;
    localName.value = locN;
    localEmail.value = locE;
    override.value = !!(locN || locE);
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

async function toggleOverride(on: boolean) {
  override.value = on;
  if (on || !isTauri() || !activePath.value) return;
  // Off → drop the local override and fall back to the inherited identity.
  // Sequential, not Promise.all: concurrent writes race on `.git/config.lock`
  // ("could not lock config file: File exists").
  try {
    await gitClient.unsetConfig({ path: activePath.value, key: 'user.name' });
    await gitClient.unsetConfig({ path: activePath.value, key: 'user.email' });
    localName.value = '';
    localEmail.value = '';
    await load();
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
    <UiAlert :variant="missing ? 'destructive' : 'info'" class="mb-5">
      <p class="min-w-0">
        <template v-if="missing">{{
          t('settings.general.gitIdentity.effectiveMissing')
        }}</template>
        <template v-else>
          {{ t('settings.general.gitIdentity.effective') }}
          <span class="font-medium"
            >{{ effectiveName }} &lt;{{ effectiveEmail }}&gt;</span
          >
        </template>
      </p>
    </UiAlert>

    <SettingsRow
      label="settings.general.gitIdentity.overrideToggle"
      hint="settings.general.gitIdentity.overrideHint"
    >
      <UiSwitch
        :model-value="override"
        class="shrink-0"
        @update:model-value="(v) => toggleOverride(v as boolean)"
      />
    </SettingsRow>

    <div v-if="override" class="mt-4 space-y-4">
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
