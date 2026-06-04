<script setup lang="ts">
import { toast } from 'vue-sonner';
import type { SshStatus } from '~/types/bindings';

// SSH key & credential helper status for the active repo's git environment
// (native or WSL). Lists public keys to copy, and offers to generate an ed25519
// key if there's none — the actionable side of auth troubleshooting.
const { t } = useI18n();
const repo = useRepoStore();
const copyText = useCopy();

const status = ref<SshStatus | null>(null);
const generating = ref(false);

const activePath = computed(() => repo.active?.path ?? '');
const hasRepo = computed(() => !!activePath.value);

async function load() {
  if (!isTauri() || !hasRepo.value) return;
  status.value = await gitClient.sshStatus(activePath.value);
}

onMounted(load);
watch(activePath, load);

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
    <div class="space-y-3 text-sm">
      <p class="text-muted-foreground">
        {{ t('settings.general.ssh.helper') }}:
        <span class="font-mono text-foreground">{{
          status?.helper || t('settings.general.ssh.none')
        }}</span>
      </p>
      <div v-if="status?.publicKeys.length" class="space-y-1.5">
        <p class="text-xs font-medium text-muted-foreground">
          {{ t('settings.general.ssh.keys') }}
        </p>
        <div
          v-for="(k, i) in status.publicKeys"
          :key="i"
          class="flex items-center gap-2"
        >
          <code
            class="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs"
            >{{ k }}</code
          >
          <UiButton
            variant="ghost"
            size="icon-sm"
            icon="lucide:copy"
            @click="copyText(k)"
          />
        </div>
      </div>
      <p v-else class="text-xs text-muted-foreground">
        {{ t('settings.general.ssh.noKeys') }}
      </p>
      <UiButton
        size="sm"
        variant="outline"
        icon="lucide:key-round"
        :pending="generating"
        @click="generate"
      >
        {{ t('settings.general.ssh.generate') }}
      </UiButton>
      <p class="text-xs text-muted-foreground">
        {{ t('settings.general.ssh.hint') }}
      </p>
    </div>
  </div>
</template>
