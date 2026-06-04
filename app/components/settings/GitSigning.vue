<script setup lang="ts">
import { toast } from 'vue-sonner';
import type { SshKey } from '~/types/bindings';

// Global commit-signing config (commit.gpgsign / gpg.format / user.signingkey),
// read & written through the active repo's git. Commits then sign automatically
// (git honours commit.gpgsign). With SSH format, the key can be picked from the
// detected public keys rather than typed.
const { t } = useI18n();
const repo = useRepoStore();

const sign = ref(false);
const format = ref('openpgp');
const signingKey = ref('');
const sshKeys = ref<SshKey[]>([]);

function keyInfo(key: string): { type: string; comment: string } {
  const parts = key.trim().split(/\s+/);
  return {
    type: (parts[0] ?? '').replace(/^ssh-/, '') || 'ssh',
    comment: parts.slice(2).join(' ')
  };
}

async function routingPath() {
  return repo.active?.path ?? (await gitClient.defaultRepo());
}

async function load() {
  if (!isTauri()) return;
  try {
    const path = await routingPath();
    const [gpgsign, fmt, key, ssh] = await Promise.all([
      gitClient.getConfig({ path, key: 'commit.gpgsign', scope: 'global' }),
      gitClient.getConfig({ path, key: 'gpg.format', scope: 'global' }),
      gitClient.getConfig({ path, key: 'user.signingkey', scope: 'global' }),
      repo.active?.path
        ? gitClient.sshStatus(repo.active.path)
        : Promise.resolve(null)
    ]);
    sign.value = gpgsign === 'true';
    format.value = fmt === 'ssh' ? 'ssh' : 'openpgp';
    signingKey.value = key;
    sshKeys.value = ssh?.publicKeys ?? [];
  } catch (e) {
    toast.error(t('settings.general.gitSigning.loadFailed'), {
      description: String(e)
    });
  }
}

onMounted(load);
watch(() => repo.active?.path, load);

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
function pickKey(v: string) {
  signingKey.value = v;
  void set('user.signingkey', v);
}
// An empty key is left untouched — the backend rejects an empty config value.
function saveKey() {
  const trimmed = signingKey.value.trim();
  if (trimmed) void set('user.signingkey', trimmed);
}

const useSshPicker = computed(
  () => format.value === 'ssh' && sshKeys.value.length > 0
);
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

        <!-- SSH: pick from detected keys; otherwise type a key id / path -->
        <SettingsRow
          v-if="useSshPicker"
          label="settings.general.gitSigning.key.label"
          hint="settings.general.gitSigning.key.sshHint"
        >
          <UiSelect
            :model-value="signingKey"
            @update:model-value="(v) => pickKey(v as string)"
          >
            <UiSelectTrigger class="w-56 shrink-0">
              <UiSelectValue
                :placeholder="t('settings.general.gitSigning.key.pick')"
              />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem
                v-for="k in sshKeys"
                :key="k.path"
                :value="k.publicKey"
              >
                {{ keyInfo(k.publicKey).type
                }}<template v-if="keyInfo(k.publicKey).comment">
                  · {{ keyInfo(k.publicKey).comment }}</template
                >
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>
        </SettingsRow>
        <SettingsRow
          v-else
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
