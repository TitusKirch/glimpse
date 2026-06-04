<script setup lang="ts">
import { toast } from 'vue-sonner';

// Commit signing config (commit.gpgsign / gpg.format / user.signingkey), read &
// written directly via git config (global), routed through the active repo so a
// WSL repo hits the right git — same approach as the identity section. Commits
// then sign automatically (git honours commit.gpgsign); a missing key or absent
// gpg/ssh-keygen surfaces as the commit's own error toast.
const { t } = useI18n();
const repo = useRepoStore();

const sign = ref(false);
const format = ref('openpgp');
const signingKey = ref('');

async function routingPath() {
  return repo.active?.path ?? (await gitClient.defaultRepo());
}

async function load() {
  if (!isTauri()) return;
  try {
    const path = await routingPath();
    const [gpgsign, fmt, key] = await Promise.all([
      gitClient.getConfig({ path, key: 'commit.gpgsign', global: true }),
      gitClient.getConfig({ path, key: 'gpg.format', global: true }),
      gitClient.getConfig({ path, key: 'user.signingkey', global: true })
    ]);
    sign.value = gpgsign === 'true';
    format.value = fmt === 'ssh' ? 'ssh' : 'openpgp';
    signingKey.value = key;
  } catch (e) {
    toast.error(t('settings.general.gitSigning.loadFailed'), {
      description: String(e)
    });
  }
}

onMounted(load);

async function set(key: string, value: string) {
  if (!isTauri()) return;
  try {
    await gitClient.setConfig({
      path: await routingPath(),
      key,
      value,
      global: true
    });
  } catch (e) {
    toast.error(t('settings.general.gitSigning.saveFailed'), {
      description: String(e)
    });
  }
}

function toggleSign(on: boolean) {
  sign.value = on;
  void set('commit.gpgsign', on ? 'true' : 'false');
}
function setFormat(v: string) {
  format.value = v;
  void set('gpg.format', v);
}
// An empty key is left untouched — the backend rejects an empty config value and
// clearing is a CLI concern — mirroring the identity fields.
function saveKey() {
  const trimmed = signingKey.value.trim();
  if (trimmed) void set('user.signingkey', trimmed);
}
</script>

<template>
  <div>
    <h3
      class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {{ t('settings.general.gitSigning.section') }}
    </h3>
    <div class="space-y-4">
      <SettingsRow
        label="settings.general.gitSigning.enable.label"
        hint="settings.general.gitSigning.enable.hint"
      >
        <UiSwitch
          :model-value="sign"
          class="shrink-0"
          @update:model-value="(v) => toggleSign(v as boolean)"
        />
      </SettingsRow>
      <template v-if="sign">
        <SettingsRow
          label="settings.general.gitSigning.format.label"
          hint="settings.general.gitSigning.format.hint"
        >
          <UiSelect
            :model-value="format"
            @update:model-value="(v) => setFormat(v as string)"
          >
            <UiSelectTrigger class="w-44 shrink-0">
              <UiSelectValue />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem value="openpgp">
                {{ t('settings.general.gitSigning.format.openpgp') }}
              </UiSelectItem>
              <UiSelectItem value="ssh">
                {{ t('settings.general.gitSigning.format.ssh') }}
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>
        </SettingsRow>
        <SettingsRow
          label="settings.general.gitSigning.key.label"
          hint="settings.general.gitSigning.key.hint"
        >
          <UiInput
            class="w-56 shrink-0"
            :model-value="signingKey"
            :placeholder="t('settings.general.gitSigning.key.placeholder')"
            @input="signingKey = ($event.target as HTMLInputElement).value"
            @blur="saveKey"
          />
        </SettingsRow>
      </template>
    </div>
  </div>
</template>
