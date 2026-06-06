<script setup lang="ts">
// Reflog recovery view: browse HEAD's reflog and reset/checkout to any entry.
// Mounted once in app.vue. Entries are fetched fresh each time it opens.
import type { ReflogEntry } from '~/types/bindings';

const { open } = useOverlay('reflog');
const repo = useRepoStore();
const { t } = useI18n();

const entries = ref<ReflogEntry[]>([]);
const loading = ref(false);

watch(open, async (isOpen) => {
  if (!isOpen) return;
  loading.value = true;
  entries.value = [];
  try {
    entries.value = await gitClient.reflog({ path: repo.repoPath });
  } finally {
    loading.value = false;
  }
});

async function resetTo(hash: string, mode: 'soft' | 'mixed' | 'hard') {
  open.value = false;
  await repo.reset({ hash, mode });
}

async function checkout(hash: string) {
  open.value = false;
  await repo.checkoutCommit(hash);
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-2xl">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('reflog.title') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('reflog.title') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="loading" class="space-y-2 py-2">
        <UiSkeleton v-for="n in 8" :key="n" class="h-7" />
      </div>
      <EmptyState
        v-else-if="!entries.length"
        icon="lucide:history"
        :title="t('reflog.empty')"
      />
      <ul v-else class="max-h-[60vh] space-y-0.5 overflow-auto">
        <li
          v-for="e in entries"
          :key="e.selector"
          class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
        >
          <code class="shrink-0 font-mono text-[11px] text-muted-foreground">{{
            e.selector
          }}</code>
          <code class="shrink-0 font-mono text-[11px] text-primary">{{
            e.hash
          }}</code>
          <span class="min-w-0 flex-1 truncate text-sm">{{ e.subject }}</span>
          <UiDropdownMenu>
            <UiDropdownMenuTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon-sm"
                icon="lucide:ellipsis"
                class="shrink-0"
                :aria-label="t('actions.more')"
              />
            </UiDropdownMenuTrigger>
            <UiDropdownMenuContent align="end">
              <UiDropdownMenuItem @click="checkout(e.hash)">
                <NuxtIcon name="lucide:git-commit-horizontal" />
                {{ t('reflog.checkout') }}
              </UiDropdownMenuItem>
              <UiDropdownMenuSeparator />
              <UiDropdownMenuItem @click="resetTo(e.hash, 'soft')">
                <NuxtIcon name="lucide:package-check" />
                {{ t('commit.reset') }} · {{ t('commit.resetSoft') }}
              </UiDropdownMenuItem>
              <UiDropdownMenuItem @click="resetTo(e.hash, 'mixed')">
                <NuxtIcon name="lucide:file-pen" />
                {{ t('commit.reset') }} · {{ t('commit.resetMixed') }}
              </UiDropdownMenuItem>
              <UiDropdownMenuItem
                class="text-destructive focus:text-destructive"
                @click="resetTo(e.hash, 'hard')"
              >
                <NuxtIcon name="lucide:trash-2" />
                {{ t('commit.reset') }} · {{ t('commit.resetHard') }}
              </UiDropdownMenuItem>
            </UiDropdownMenuContent>
          </UiDropdownMenu>
        </li>
      </ul>
    </UiDialogContent>
  </UiDialog>
</template>
