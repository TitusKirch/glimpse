<script setup lang="ts">
import type { StatusEntry } from '@/stores/repo';

const repo = useRepoStore();
const settings = useSettingsStore();
const mergeEditor = useMergeEditor();
const { t } = useI18n();

// Single, consistent letter per file: A = new/untracked, M = modified,
// D = deleted, R = renamed. (git's literal "?"/"U" codes are not user-facing.)
function letter({
  entry,
  staged
}: {
  entry: StatusEntry;
  staged: boolean;
}): string {
  const c = (staged ? entry.x : entry.y).trim();
  if (!c || c === '?') return 'A';
  return c;
}

// FileTree items carry the display letter plus the original entry fields.
const stagedItems = computed(() =>
  repo.stagedFiles.map((f) => ({
    ...f,
    status: letter({ entry: f, staged: true })
  }))
);
const unstagedItems = computed(() =>
  repo.unstagedFiles.map((f) => ({
    ...f,
    status: letter({ entry: f, staged: false })
  }))
);
// Conflicts carry a "U" (unmerged) letter; the section header already flags them.
const conflictItems = computed(() =>
  repo.conflictedFiles.map((f) => ({ ...f, status: 'U' }))
);
</script>

<template>
  <div class="flex h-full flex-col text-sm">
    <FileViewToggle class="border-b" />
    <ChangesBanners />

    <div class="min-h-0 flex-1 overflow-auto">
      <!-- loading skeleton -->
      <div v-if="repo.loading && !repo.status.length" class="space-y-2 p-3">
        <UiSkeleton v-for="n in 6" :key="n" class="h-6 w-full" />
      </div>

      <!-- merge conflicts -->
      <section v-if="repo.conflictedFiles.length" class="px-1">
        <h3
          class="sticky top-0 z-10 bg-background px-2 py-1.5 text-xs font-semibold tracking-wide text-warning uppercase"
        >
          {{ t('changes.conflicts') }} ({{ repo.conflictedFiles.length }})
        </h3>
        <FileTree
          :files="conflictItems"
          :view="settings.fileView"
          :selected="!repo.selectedFileStaged ? repo.selectedFile : null"
          @select="(p) => repo.selectFile({ file: p, staged: false })"
        >
          <template #actions="{ file }">
            <UiDropdownMenu>
              <UiDropdownMenuTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  icon="lucide:ellipsis"
                  icon-size="sm"
                  :aria-label="t('actions.more')"
                  @click.stop
                />
              </UiDropdownMenuTrigger>
              <UiDropdownMenuContent align="end">
                <UiDropdownMenuItem @click="mergeEditor.show(file.path)">
                  <NuxtIcon name="lucide:git-merge" />
                  {{ t('merge.open') }}
                </UiDropdownMenuItem>
                <UiDropdownMenuSeparator />
                <UiDropdownMenuItem
                  @click="
                    repo.resolveConflict({ file: file.path, side: 'ours' })
                  "
                >
                  {{ t('changes.useOurs') }}
                </UiDropdownMenuItem>
                <UiDropdownMenuItem
                  @click="
                    repo.resolveConflict({ file: file.path, side: 'theirs' })
                  "
                >
                  {{ t('changes.useTheirs') }}
                </UiDropdownMenuItem>
                <UiDropdownMenuSeparator />
                <UiDropdownMenuItem
                  @click="
                    repo.resolveConflict({ file: file.path, side: 'mark' })
                  "
                >
                  {{ t('changes.markResolved') }}
                </UiDropdownMenuItem>
              </UiDropdownMenuContent>
            </UiDropdownMenu>
          </template>
        </FileTree>
      </section>

      <!-- staged -->
      <section v-if="repo.stagedFiles.length" class="px-1">
        <h3
          class="sticky top-0 z-10 bg-background px-2 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ t('changes.staged') }} ({{ repo.stagedFiles.length }})
        </h3>
        <FileTree
          :files="stagedItems"
          :view="settings.fileView"
          :selected="repo.selectedFileStaged ? repo.selectedFile : null"
          @select="(p) => repo.selectFile({ file: p, staged: true })"
        >
          <template #actions="{ file }">
            <UiTooltip>
              <UiTooltipTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  icon="lucide:minus"
                  icon-size="sm"
                  :aria-label="t('changes.unstage')"
                  @click.stop="repo.unstage(file.path)"
                />
              </UiTooltipTrigger>
              <UiTooltipContent>{{ t('changes.unstage') }}</UiTooltipContent>
            </UiTooltip>
          </template>
        </FileTree>
      </section>

      <!-- unstaged / untracked -->
      <section v-if="repo.unstagedFiles.length" class="group/sec px-1">
        <h3
          class="sticky top-0 z-10 flex items-center gap-2 bg-background px-2 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          <span
            >{{ t('changes.unstaged') }} ({{ repo.unstagedFiles.length }})</span
          >
          <UiTooltip>
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon"
                class="ml-auto size-5 opacity-0 group-hover/sec:opacity-100"
                icon="lucide:undo-2"
                icon-size="sm"
                :aria-label="t('changes.discardAll')"
                @click="repo.discardAll()"
              />
            </UiTooltipTrigger>
            <UiTooltipContent>{{ t('changes.discardAll') }}</UiTooltipContent>
          </UiTooltip>
        </h3>
        <FileTree
          :files="unstagedItems"
          :view="settings.fileView"
          :selected="!repo.selectedFileStaged ? repo.selectedFile : null"
          @select="(p) => repo.selectFile({ file: p, staged: false })"
        >
          <template #actions="{ file }">
            <UiTooltip>
              <UiTooltipTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  icon="lucide:undo-2"
                  icon-size="sm"
                  :aria-label="t('changes.discard')"
                  @click.stop="
                    repo.discard({ file: file.path, untracked: file.untracked })
                  "
                />
              </UiTooltipTrigger>
              <UiTooltipContent>{{ t('changes.discard') }}</UiTooltipContent>
            </UiTooltip>
            <UiTooltip>
              <UiTooltipTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  icon="lucide:plus"
                  icon-size="sm"
                  :aria-label="t('changes.stage')"
                  @click.stop="repo.stage(file.path)"
                />
              </UiTooltipTrigger>
              <UiTooltipContent>{{ t('changes.stage') }}</UiTooltipContent>
            </UiTooltip>
          </template>
        </FileTree>
      </section>

      <EmptyState
        v-if="!repo.loading && !repo.status.length"
        icon="lucide:check"
        :title="t('changes.clean')"
        :description="t('changes.cleanHint')"
      />
    </div>

    <!-- commit box (commits the staged set) -->
    <ChangesCommitBox
      :count="repo.stagedFiles.length"
      @submit="repo.commit()"
    />
  </div>
</template>
