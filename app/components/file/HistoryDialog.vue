<script setup lang="ts">
// Lists the commits that touched a file (follows renames). Selecting one opens
// it in the history/diff view. Loads lazily each time it is opened.
import type { Commit } from '@/stores/repo';

const open = defineModel<boolean>('open', { required: true });
const props = defineProps<{ file: string | null }>();

const repo = useRepoStore();
const { t } = useI18n();

const commits = ref<Commit[]>([]);
const loading = ref(false);

watch(open, async (isOpen) => {
  if (!isOpen || !props.file) return;
  loading.value = true;
  commits.value = [];
  try {
    commits.value = await gitClient.fileHistory({
      path: repo.repoPath,
      file: props.file
    });
  } finally {
    loading.value = false;
  }
});

function pick(hash: string) {
  void repo.selectCommit(hash);
  open.value = false;
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="flex h-[70vh] max-w-2xl flex-col gap-0 p-0">
      <UiDialogHeader class="border-b px-5 py-3">
        <UiDialogTitle class="truncate font-mono text-sm">
          {{ file }}
        </UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('diff.fileHistory') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="min-h-0 flex-1 overflow-auto p-2">
        <div v-if="loading" class="space-y-2 p-2">
          <UiSkeleton v-for="n in 6" :key="n" class="h-10 w-full" />
        </div>
        <EmptyState
          v-else-if="!commits.length"
          icon="lucide:file-clock"
          :title="t('history.noMatches')"
        />
        <ul v-else class="space-y-0.5">
          <li
            v-for="c in commits"
            :key="c.hash"
            class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
            @click="pick(c.hash)"
          >
            <div class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ c.subject }}</span>
              <span class="block truncate text-xs text-muted-foreground">
                {{ c.author }} · {{ c.date }}
              </span>
            </div>
            <code
              class="shrink-0 font-mono text-[11px] text-muted-foreground"
              >{{ c.hash.slice(0, 7) }}</code
            >
          </li>
        </ul>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
