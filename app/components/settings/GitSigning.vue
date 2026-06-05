<script setup lang="ts">
import { toast } from 'vue-sonner';
import type { SshKey } from '~/types/bindings';

// Commit-signing config (commit.gpgsign / gpg.format / user.signingkey) at a
// given scope. `global` is a plain on/off applying to every repo; `local` is a
// tri-state override for this repo (Inherit / On / Off) — Inherit clears the
// local keys so the global setting applies. Read & written through the active
// repo's git. With SSH format the key can be picked from detected public keys.
const props = withDefaults(defineProps<{ scope?: 'global' | 'local' }>(), {
  scope: 'global'
});
const { t } = useI18n();
const repo = useRepoStore();
const cfg = useGitConfig();

const isGlobal = computed(() => props.scope === 'global');

const sign = ref(false); // global on/off
const signMode = ref<'inherit' | 'on' | 'off'>('inherit'); // local tri-state
const format = ref('openpgp');
const signingKey = ref('');
const sshKeys = ref<SshKey[]>([]);

// Whether signing details (format + key) are editable: global → when on; local
// → only when explicitly overriding to On (Inherit/Off use the global details).
const showDetails = computed(() =>
  isGlobal.value ? sign.value : signMode.value === 'on'
);
const useSshPicker = computed(
  () => format.value === 'ssh' && sshKeys.value.length > 0
);

async function load() {
  if (!isTauri()) return;
  try {
    const [gpgsign, fmt, key, ssh] = await Promise.all([
      cfg.read('commit.gpgsign', props.scope),
      cfg.read('gpg.format', props.scope),
      cfg.read('user.signingkey', props.scope),
      repo.active?.path
        ? gitClient.sshStatus(repo.active.path)
        : Promise.resolve(null)
    ]);
    if (isGlobal.value) sign.value = gpgsign === 'true';
    else signMode.value = toTriState(gpgsign);
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
watch([() => repo.active?.path, () => props.scope], load);

async function setCfg(key: string, value: string) {
  await cfg.write(key, value, props.scope);
}
async function unsetCfg(key: string) {
  await cfg.clear(key, props.scope);
}

function fail(e: unknown) {
  toast.error(t('settings.general.gitSigning.saveFailed'), {
    description: String(e)
  });
}

function toggleSign(on: boolean) {
  sign.value = on;
  setCfg('commit.gpgsign', on ? 'true' : 'false').catch(fail);
}

async function setSignMode(v: 'inherit' | 'on' | 'off') {
  signMode.value = v;
  try {
    if (v === 'inherit') {
      // Drop the whole local signing override. Sequential — concurrent unsets
      // race on .git/config.lock.
      await unsetCfg('commit.gpgsign');
      await unsetCfg('gpg.format');
      await unsetCfg('user.signingkey');
    } else {
      await setCfg('commit.gpgsign', v === 'on' ? 'true' : 'false');
    }
  } catch (e) {
    fail(e);
  }
}

function setFormat(v: string) {
  format.value = v;
  setCfg('gpg.format', v).catch(fail);
}
function pickKey(v: string) {
  signingKey.value = v;
  setCfg('user.signingkey', v).catch(fail);
}
async function saveKey() {
  const trimmed = signingKey.value.trim();
  try {
    if (trimmed) await setCfg('user.signingkey', trimmed);
    else if (!isGlobal.value) await unsetCfg('user.signingkey');
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
      {{ t('settings.general.gitSigning.section') }}
    </h3>
    <div class="space-y-4">
      <!-- enable: global = switch, local = tri-state override -->
      <SettingsRow
        label="settings.general.gitSigning.enable.label"
        hint="settings.general.gitSigning.enable.hint"
      >
        <UiSwitch
          v-if="isGlobal"
          :model-value="sign"
          class="shrink-0"
          @update:model-value="(v) => toggleSign(v as boolean)"
        />
        <UiSelect
          v-else
          :model-value="signMode"
          @update:model-value="
            (v) => setSignMode(v as 'inherit' | 'on' | 'off')
          "
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

      <template v-if="showDetails">
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
                {{ parseSshKeyLine(k.publicKey).type
                }}<template v-if="parseSshKeyLine(k.publicKey).comment">
                  · {{ parseSshKeyLine(k.publicKey).comment }}</template
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
