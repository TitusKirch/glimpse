<script setup lang="ts">
import type { StatusEntry } from '@/stores/repo';

const repo = useRepoStore();
const layout = useLayoutStore();
const { t } = useI18n();

const modLabel = navigator.platform.toLowerCase().includes('mac')
  ? '⌘'
  : 'Ctrl';

// Single, consistent letter per file: A = new/untracked, M = modified,
// D = deleted, R = renamed. (git's literal "?"/"U" codes are not user-facing.)
function letter(f: StatusEntry, staged: boolean): string {
  const c = (staged ? f.x : f.y).trim();
  if (!c || c === '?') return 'A';
  return c;
}

// FileTree items carry the display letter plus the original entry fields.
const stagedItems = computed(() =>
  repo.stagedFiles.map((f) => ({ ...f, status: letter(f, true) }))
);
const unstagedItems = computed(() =>
  repo.unstagedFiles.map((f) => ({ ...f, status: letter(f, false) }))
);

// Subject is the first line; git convention favours <= 50 chars (warn), and
// hard-wraps the eye at 72 (over). Drives the live counter colour.
const subjectLen = computed(
  () => repo.commitMessage.split('\n')[0]?.length ?? 0
);
const subjectClass = computed(() =>
  subjectLen.value > 72
    ? 'text-destructive'
    : subjectLen.value > 50
      ? 'text-warning'
      : 'text-muted-foreground'
);

const canCommit = computed(
  () =>
    !!repo.commitMessage.trim() && (repo.amend || repo.stagedFiles.length > 0)
);
</script>

<template>
  <div class="flex h-full flex-col text-sm">
    <FileViewToggle class="border-b" />

    <div class="min-h-0 flex-1 overflow-auto">
      <!-- loading skeleton -->
      <div v-if="repo.loading && !repo.status.length" class="space-y-2 p-3">
        <UiSkeleton v-for="n in 6" :key="n" class="h-6 w-full" />
      </div>

      <!-- staged -->
      <section v-if="repo.stagedFiles.length" class="px-1">
        <h3
          class="sticky top-0 z-10 bg-background px-2 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ t('changes.staged') }} ({{ repo.stagedFiles.length }})
        </h3>
        <FileTree
          :files="stagedItems"
          :view="layout.fileView"
          :selected="repo.selectedFileStaged ? repo.selectedFile : null"
          @select="(p) => repo.selectFile(p, true)"
        >
          <template #actions="{ file }">
            <UiTooltip>
              <UiTooltipTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  @click.stop="repo.unstage(file.path)"
                >
                  <NuxtIcon name="lucide:minus" class="size-3.5" />
                </UiButton>
              </UiTooltipTrigger>
              <UiTooltipContent>{{ t('changes.unstage') }}</UiTooltipContent>
            </UiTooltip>
          </template>
        </FileTree>
      </section>

      <!-- unstaged / untracked -->
      <section v-if="repo.unstagedFiles.length" class="px-1">
        <h3
          class="sticky top-0 z-10 bg-background px-2 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ t('changes.unstaged') }} ({{ repo.unstagedFiles.length }})
        </h3>
        <FileTree
          :files="unstagedItems"
          :view="layout.fileView"
          :selected="!repo.selectedFileStaged ? repo.selectedFile : null"
          @select="(p) => repo.selectFile(p, false)"
        >
          <template #actions="{ file }">
            <UiTooltip>
              <UiTooltipTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  @click.stop="repo.discard(file.path, file.untracked)"
                >
                  <NuxtIcon name="lucide:undo-2" class="size-3.5" />
                </UiButton>
              </UiTooltipTrigger>
              <UiTooltipContent>{{ t('changes.discard') }}</UiTooltipContent>
            </UiTooltip>
            <UiTooltip>
              <UiTooltipTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  @click.stop="repo.stage(file.path)"
                >
                  <NuxtIcon name="lucide:plus" class="size-3.5" />
                </UiButton>
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

    <!-- commit box -->
    <div class="border-t p-2">
      <div class="relative">
        <textarea
          v-model="repo.commitMessage"
          rows="3"
          :placeholder="t('changes.commit.placeholder')"
          class="w-full resize-none rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span
          class="pointer-events-none absolute right-2 bottom-1.5 font-mono text-[10px]"
          :class="subjectClass"
          >{{ subjectLen }}</span
        >
      </div>

      <div class="mt-2 flex items-center justify-between gap-2">
        <label class="flex cursor-pointer items-center gap-1.5 text-xs">
          <UiSwitch
            :model-value="repo.amend"
            @update:model-value="repo.setAmend($event)"
          />
          <span class="text-muted-foreground">{{ t('changes.amend') }}</span>
        </label>
        <UiKbd>{{ modLabel }}+↵</UiKbd>
      </div>

      <UiButton
        class="mt-2 w-full"
        size="sm"
        :disabled="!canCommit"
        @click="repo.commit()"
      >
        {{ repo.amend ? t('changes.amendCommit') : t('changes.commit.label') }}
        <span v-if="!repo.amend && repo.stagedFiles.length"
          >({{ repo.stagedFiles.length }})</span
        >
      </UiButton>
    </div>
  </div>
</template>
