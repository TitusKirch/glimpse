<script setup lang="ts">
import { toast } from 'vue-sonner';
import type { SshStatus } from '~/types/bindings';

// SSH key & credential helper status for the active repo's git environment
// (native or WSL): the configured credential helper (for HTTPS), the public SSH
// keys (copyable), a per-repo key picker (writes `core.sshCommand` so this repo
// authenticates with the chosen key), and one-click ed25519 generation when
// none exists yet.
const { t } = useI18n();
const repo = useRepoStore();
const copyText = useCopy();

const status = ref<SshStatus | null>(null);
const generating = ref(false);
// 'default' (let ssh resolve the key) or a detected key's private-key path.
const selectedKey = ref('default');

const activePath = computed(() => repo.active?.path ?? '');
const hasRepo = computed(() => !!activePath.value);

// True once a default-named ed25519 key exists — generating would only error, so
// we hide the button and show a note instead.
const hasEd25519 = computed(
  () =>
    status.value?.publicKeys.some((k) =>
      k.publicKey.startsWith('ssh-ed25519')
    ) ?? false
);

// A public key line is `<type> <base64> [comment]`; show the type + comment
// rather than the long base64 blob.
function keyInfo(key: string): { type: string; comment: string } {
  const parts = key.trim().split(/\s+/);
  return {
    type: (parts[0] ?? '').replace(/^ssh-/, '') || 'ssh',
    comment: parts.slice(2).join(' ')
  };
}

// Pull the `-i <path>` argument out of a `core.sshCommand` value.
function sshCommandKey(cmd: string): string {
  const m = cmd.match(/-i\s+(?:"([^"]*)"|(\S+))/);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

async function load() {
  if (!isTauri() || !hasRepo.value) return;
  status.value = await gitClient.sshStatus(activePath.value);
  const cmd = await gitClient.getConfig({
    path: activePath.value,
    key: 'core.sshCommand',
    scope: 'local'
  });
  const keyPath = cmd ? sshCommandKey(cmd) : '';
  // Reflect the stored key only when it's one we detected; else fall to default.
  selectedKey.value = status.value?.publicKeys.some((k) => k.path === keyPath)
    ? keyPath
    : 'default';
}

onMounted(load);
watch(activePath, load);

async function pickRepoKey(value: string) {
  selectedKey.value = value;
  if (!isTauri() || !hasRepo.value) return;
  try {
    if (value === 'default') {
      await gitClient.unsetConfig({
        path: activePath.value,
        key: 'core.sshCommand'
      });
    } else {
      await gitClient.setConfig({
        path: activePath.value,
        key: 'core.sshCommand',
        value: `ssh -i "${value}" -o IdentitiesOnly=yes`,
        global: false
      });
    }
  } catch (e) {
    toast.error(t('settings.general.ssh.useKeyFailed'), {
      description: String(e)
    });
  }
}

async function generate() {
  if (!isTauri() || !hasRepo.value) return;
  generating.value = true;
  try {
    const pub = await gitClient.generateSshKey(activePath.value);
    if (pub) {
      void copyText(pub);
      toast.success(t('settings.general.ssh.generated'));
    }
    await load();
  } catch (e) {
    toast.error(t('settings.general.ssh.generateFailed'), {
      description: String(e)
    });
  } finally {
    generating.value = false;
  }
}
</script>

<template>
  <div v-if="hasRepo">
    <h3
      class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {{ t('settings.general.ssh.section') }}
    </h3>
    <div class="space-y-4 text-sm">
      <!-- credential helper (HTTPS) -->
      <div>
        <p>
          {{ t('settings.general.ssh.helper') }}:
          <span class="font-mono">{{
            status?.helper || t('settings.general.ssh.none')
          }}</span>
        </p>
        <p class="text-xs text-muted-foreground">
          {{ t('settings.general.ssh.helperHint') }}
        </p>
      </div>

      <!-- SSH public keys -->
      <div class="space-y-1.5">
        <p class="text-xs font-medium text-muted-foreground">
          {{ t('settings.general.ssh.keys') }}
        </p>
        <div
          v-for="k in status?.publicKeys ?? []"
          :key="k.path"
          class="flex items-center gap-2 rounded-md border px-2 py-1.5"
        >
          <NuxtIcon
            name="lucide:key-round"
            class="size-4 shrink-0 text-muted-foreground"
          />
          <span class="min-w-0 flex-1 truncate">
            <span class="font-medium">{{ keyInfo(k.publicKey).type }}</span>
            <span
              v-if="keyInfo(k.publicKey).comment"
              class="text-muted-foreground"
            >
              · {{ keyInfo(k.publicKey).comment }}</span
            >
          </span>
          <UiButton
            variant="ghost"
            size="icon-sm"
            icon="lucide:copy"
            :title="t('settings.general.ssh.copy')"
            @click="copyText(k.publicKey)"
          />
        </div>
        <p
          v-if="!status?.publicKeys.length"
          class="text-xs text-muted-foreground"
        >
          {{ t('settings.general.ssh.noKeys') }}
        </p>
      </div>

      <!-- which key this repo authenticates with (core.sshCommand) -->
      <SettingsRow
        v-if="status?.publicKeys.length"
        label="settings.general.ssh.useKey.label"
        hint="settings.general.ssh.useKey.hint"
      >
        <UiSelect
          :model-value="selectedKey"
          @update:model-value="(v) => pickRepoKey(v as string)"
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
              {{ keyInfo(k.publicKey).type
              }}<template v-if="keyInfo(k.publicKey).comment">
                · {{ keyInfo(k.publicKey).comment }}</template
              >
            </UiSelectItem>
          </UiSelectContent>
        </UiSelect>
      </SettingsRow>

      <!-- generate (only when there's no ed25519 key yet) -->
      <div>
        <UiButton
          v-if="!hasEd25519"
          size="sm"
          variant="outline"
          icon="lucide:key-round"
          :pending="generating"
          @click="generate"
        >
          {{ t('settings.general.ssh.generate') }}
        </UiButton>
        <p v-else class="text-xs text-muted-foreground">
          {{ t('settings.general.ssh.hasKey') }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('settings.general.ssh.hint') }}
        </p>
      </div>
    </div>
  </div>
</template>
