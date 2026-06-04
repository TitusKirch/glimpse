<script setup lang="ts">
import { toast } from 'vue-sonner';
import type { SshStatus } from '~/types/bindings';

// SSH keys & credential helper for the active git environment (native or WSL):
// the credential helper used for HTTPS remotes, the detected public keys
// (copyable), and one-click ed25519 generation when none exists yet. These are
// environment-global; the per-repo "use this key" choice lives in the Repository
// override (see RepoSshKey).
const { t } = useI18n();
const repo = useRepoStore();
const copyText = useCopy();

const status = ref<SshStatus | null>(null);
const generating = ref(false);

const env = computed(() => {
  const a = repo.active;
  if (!a) return '';
  return a.flavor === 'wsl' && a.distro ? `WSL · ${a.distro}` : a.flavor;
});

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

async function routingPath() {
  return repo.active?.path ?? (await gitClient.defaultRepo());
}

async function load() {
  if (!isTauri()) return;
  try {
    status.value = await gitClient.sshStatus(await routingPath());
  } catch {
    status.value = null;
  }
}

onMounted(load);
watch(() => repo.active?.path, load);

async function generate() {
  if (!isTauri()) return;
  generating.value = true;
  try {
    const pub = await gitClient.generateSshKey(await routingPath());
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
  <div>
    <h3
      class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {{ t('settings.general.ssh.section')
      }}<span v-if="env" class="ml-1 normal-case">· {{ env }}</span>
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
