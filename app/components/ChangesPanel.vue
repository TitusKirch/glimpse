<script setup lang="ts">
import type { StatusEntry } from '@/stores/repo';

const repo = useRepoStore();
const layout = useLayoutStore();
const { t } = useI18n();

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
</script>

<template>
  <div class="flex h-full flex-col text-sm">
    <FileViewToggle class="border-b" />

    <div class="min-h-0 flex-1 overflow-auto">
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

      <p v-if="!repo.status.length" class="p-4 text-muted-foreground">
        {{ t('changes.clean') }}
      </p>
    </div>

    <!-- commit box -->
    <div class="border-t p-2">
      <textarea
        v-model="repo.commitMessage"
        rows="3"
        :placeholder="t('changes.commit.placeholder')"
        class="w-full resize-none rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <UiButton
        class="mt-2 w-full"
        size="sm"
        :disabled="!repo.stagedFiles.length || !repo.commitMessage.trim()"
        @click="repo.commit()"
      >
        {{ t('changes.commit.label') }} ({{ repo.stagedFiles.length }})
      </UiButton>
    </div>
  </div>
</template>
