<script setup lang="ts">
// Sparse-checkout: enable/disable and edit the set of included paths (cone-mode
// directories). Applying it changes the working tree, so the file views refresh
// to the new sparse set. Mounted once in app.vue.
import type { SparseStatus } from '~/types/bindings';

const { open } = useOverlay('sparse');
const repo = useRepoStore();
const { t } = useI18n();

const status = ref<SparseStatus>({ enabled: false, patterns: [] });
const text = ref('');
const loading = ref(false);
const busy = ref(false);

async function load() {
  loading.value = true;
  try {
    status.value = await gitClient.sparseStatus(repo.repoPath);
    text.value = status.value.patterns.join('\n');
  } finally {
    loading.value = false;
  }
}

watch(open, (isOpen) => {
  if (isOpen) void load();
});

const patterns = computed(() =>
  text.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
);

async function apply() {
  if (!patterns.value.length) return;
  busy.value = true;
  try {
    await repo.sparseSet(patterns.value);
    await load();
  } finally {
    busy.value = false;
  }
}

async function disable() {
  busy.value = true;
  try {
    await repo.sparseDisable();
    await load();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-md">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('sparse.title') }}</UiDialogTitle>
        <UiDialogDescription>{{ t('sparse.description') }}</UiDialogDescription>
      </UiDialogHeader>

      <div v-if="loading" class="space-y-2">
        <UiSkeleton class="h-24 w-full" />
      </div>
      <template v-else>
        <p class="text-xs text-muted-foreground">
          {{ status.enabled ? t('sparse.enabled') : t('sparse.disabled') }}
        </p>
        <textarea
          v-model="text"
          rows="6"
          :placeholder="t('sparse.placeholder')"
          class="w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-xs focus:ring-1 focus:ring-ring focus:outline-none"
        />
        <div class="flex items-center justify-between gap-2">
          <UiButton
            v-if="status.enabled"
            variant="outline"
            :pending="busy"
            @click="disable"
          >
            {{ t('sparse.disable') }}
          </UiButton>
          <span v-else />
          <UiButton :disabled="!patterns.length" :pending="busy" @click="apply">
            {{ t('sparse.apply') }}
          </UiButton>
        </div>
      </template>
    </UiDialogContent>
  </UiDialog>
</template>
