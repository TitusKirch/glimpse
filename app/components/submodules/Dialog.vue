<script setup lang="ts">
// List submodules and their status; init+update or sync them. Pointer changes
// already render in the diff viewer (git's "Subproject commit" lines). Mounted
// once in app.vue.
import type { Submodule } from '~/types/bindings';

const { open } = useOverlay('submodules');
const repo = useRepoStore();
const { t } = useI18n();

const subs = ref<Submodule[]>([]);
const loading = ref(false);
const busy = ref(false);

async function load() {
  loading.value = true;
  try {
    subs.value = await gitClient.submodules(repo.repoPath);
  } finally {
    loading.value = false;
  }
}

watch(open, (isOpen) => {
  if (isOpen) void load();
});

async function update() {
  busy.value = true;
  try {
    await repo.submoduleUpdate();
    await load();
  } finally {
    busy.value = false;
  }
}

async function sync() {
  busy.value = true;
  try {
    await repo.submoduleSync();
    await load();
  } finally {
    busy.value = false;
  }
}

function stateLabel(s: string): string {
  if (s === '+') return t('submodule.needsUpdate');
  if (s === '-') return t('submodule.uninitialised');
  if (s === 'U') return t('submodule.conflicts');
  return t('submodule.inSync');
}

function stateVariant(s: string) {
  if (s === '+') return 'warning' as const;
  if (s === '-') return 'secondary' as const;
  if (s === 'U') return 'destructive' as const;
  return 'success' as const;
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-2xl">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('submodule.title') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('submodule.title') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="flex gap-2">
        <UiButton
          size="sm"
          icon="lucide:download"
          :pending="busy"
          @click="update"
        >
          {{ t('submodule.update') }}
        </UiButton>
        <UiButton
          size="sm"
          variant="outline"
          icon="lucide:refresh-cw"
          :pending="busy"
          @click="sync"
        >
          {{ t('submodule.sync') }}
        </UiButton>
      </div>

      <div v-if="loading" class="space-y-2">
        <UiSkeleton v-for="n in 3" :key="n" class="h-9" />
      </div>
      <EmptyState
        v-else-if="!subs.length"
        icon="lucide:box"
        :title="t('submodule.empty')"
      />
      <ul v-else class="max-h-[55vh] space-y-1 overflow-auto">
        <li
          v-for="s in subs"
          :key="s.path"
          class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
        >
          <NuxtIcon
            name="lucide:box"
            class="size-4 shrink-0 text-muted-foreground"
          />
          <div class="min-w-0 flex-1">
            <span class="block truncate text-sm">{{ s.path }}</span>
            <code class="block truncate text-xs text-muted-foreground">{{
              s.sha
            }}</code>
          </div>
          <UiBadge :variant="stateVariant(s.state)" size="sm">
            {{ stateLabel(s.state) }}
          </UiBadge>
        </li>
      </ul>
    </UiDialogContent>
  </UiDialog>
</template>
