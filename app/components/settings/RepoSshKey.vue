<script setup lang="ts">
import { toast } from 'vue-sonner';
import type { SshStatus } from '~/types/bindings';

// Per-repo SSH key: writes `core.sshCommand` (local) so this repo authenticates
// over SSH with the chosen key. Options are the keys detected in the repo's git
// environment; "Default" clears the override. Only meaningful with a repo open.
const { t } = useI18n();
const repo = useRepoStore();
const cfg = useGitConfig();

const status = ref<SshStatus | null>(null);
// 'default' (let ssh resolve the key) or a detected key's private-key path.
const selectedKey = ref('default');

const activePath = computed(() => repo.active?.path ?? '');

async function load() {
  if (!isTauri() || !activePath.value) return;
  status.value = await gitClient.sshStatus(activePath.value);
  const cmd = await cfg.read('core.sshCommand', 'local');
  const keyPath = cmd ? sshCommandKeyPath(cmd) : '';
  // Reflect the stored key only when it's one we detected; else fall to default.
  selectedKey.value = status.value?.publicKeys.some((k) => k.path === keyPath)
    ? keyPath
    : 'default';
}

onMounted(load);
watch(activePath, load);

async function pick(value: string) {
  selectedKey.value = value;
  if (!isTauri() || !activePath.value) return;
  try {
    if (value === 'default') await cfg.clear('core.sshCommand', 'local');
    else await cfg.write('core.sshCommand', buildSshCommand(value), 'local');
  } catch (e) {
    toast.error(t('settings.general.ssh.useKeyFailed'), {
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
      {{ t('settings.general.ssh.useKey.section') }}
    </h3>
    <SettingsRow
      label="settings.general.ssh.useKey.label"
      hint="settings.general.ssh.useKey.hint"
    >
      <UiSelect
        :model-value="selectedKey"
        @update:model-value="(v) => pick(v as string)"
      >
        <UiSelectTrigger class="w-56 shrink-0">
          <UiSelectValue />
        </UiSelectTrigger>
        <UiSelectContent>
          <UiSelectItem value="default">
            {{ t('settings.general.ssh.useKey.default') }}
          </UiSelectItem>
          <UiSelectItem
            v-for="k in status?.publicKeys ?? []"
            :key="k.path"
            :value="k.path"
          >
            {{ parseSshKeyLine(k.publicKey).type
            }}<template v-if="parseSshKeyLine(k.publicKey).comment">
              · {{ parseSshKeyLine(k.publicKey).comment }}</template
            >
          </UiSelectItem>
        </UiSelectContent>
      </UiSelect>
    </SettingsRow>
  </div>
</template>
