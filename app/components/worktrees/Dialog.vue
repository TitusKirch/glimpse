<script setup lang="ts">
// Manage linked worktrees: list them, add one (optional ref), remove, or open
// one as its own repo tab. Mounted once in app.vue.
import type { Worktree } from '~/types/bindings';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const { open, hide } = useOverlay('worktrees');
const repo = useRepoStore();
const { t } = useI18n();

const worktrees = ref<Worktree[]>([]);
const loading = ref(false);
const adding = ref(false);
const addRef = ref('');

const refs = computed(() => [
  ...repo.branches.map((b) => b.name),
  ...repo.remoteBranches,
  ...repo.tags
]);

async function load() {
  loading.value = true;
  try {
    worktrees.value = await gitClient.worktrees(repo.repoPath);
  } finally {
    loading.value = false;
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    addRef.value = '';
    void load();
  }
});

async function add() {
  if (!isTauri()) return;
  const path = await openDialog({
    directory: true,
    multiple: false,
    title: t('worktree.add')
  });
  if (typeof path !== 'string') return;
  adding.value = true;
  try {
    await repo.worktreeAdd({ path, ref: addRef.value || undefined });
    await load();
  } finally {
    adding.value = false;
  }
}

async function remove(path: string) {
  const ok = await useConfirm().confirm({
    titleKey: 'worktree.removeConfirm.title',
    descriptionKey: 'worktree.removeConfirm.description',
    confirmKey: 'worktree.remove',
    destructive: true
  });
  if (!ok) return;
  await repo.worktreeRemove(path);
  await load();
}

async function openWt(path: string) {
  hide();
  await repo.openRepo(path);
}

function subtitle(w: Worktree): string {
  if (w.bare) return 'bare';
  if (w.detached) return w.head;
  return w.branch || w.head;
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-2xl">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('worktree.title') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('worktree.title') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="flex items-center gap-2">
        <UiSelect
          :model-value="addRef"
          @update:model-value="(v) => (addRef = v as string)"
        >
          <UiSelectTrigger class="w-48">
            <UiSelectValue :placeholder="t('worktree.refOptional')" />
          </UiSelectTrigger>
          <UiSelectContent>
            <UiSelectItem v-for="r in refs" :key="r" :value="r">
              {{ r }}
            </UiSelectItem>
          </UiSelectContent>
        </UiSelect>
        <UiButton icon="lucide:folder-plus" :pending="adding" @click="add">
          {{ t('worktree.add') }}
        </UiButton>
      </div>
      <p class="text-xs text-muted-foreground">{{ t('worktree.addHint') }}</p>

      <div v-if="loading" class="space-y-2">
        <UiSkeleton v-for="n in 4" :key="n" class="h-9" />
      </div>
      <ul v-else class="max-h-[55vh] space-y-1 overflow-auto">
        <li
          v-for="w in worktrees"
          :key="w.path"
          class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
        >
          <NuxtIcon
            name="lucide:folder-git-2"
            class="size-4 shrink-0 text-muted-foreground"
          />
          <div class="min-w-0 flex-1">
            <span class="block truncate text-sm">{{ w.path }}</span>
            <span class="block truncate text-xs text-muted-foreground">
              {{ subtitle(w)
              }}<template v-if="w.locked">
                · {{ t('worktree.locked') }}</template
              >
            </span>
          </div>
          <UiButton variant="ghost" size="sm" @click="openWt(w.path)">
            {{ t('worktree.open') }}
          </UiButton>
          <UiButton
            variant="ghost"
            size="icon-sm"
            class="text-destructive hover:text-destructive"
            icon="lucide:trash-2"
            @click="remove(w.path)"
          />
        </li>
      </ul>
    </UiDialogContent>
  </UiDialog>
</template>
