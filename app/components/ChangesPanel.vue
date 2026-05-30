<script setup lang="ts">
import type { StatusEntry } from '@/stores/repo';

const repo = useRepoStore();
const { t } = useI18n();

// Single, consistent letter per file: A = new/untracked, M = modified,
// D = deleted, R = renamed. (git's literal "?"/"U" codes are not user-facing.)
function letter(f: StatusEntry, staged: boolean): string {
  const c = (staged ? f.x : f.y).trim();
  if (!c || c === '?') return 'A';
  return c;
}

function isSelected(path: string, staged: boolean): boolean {
  return repo.selectedFile === path && repo.selectedFileStaged === staged;
}
</script>

<template>
  <div class="flex h-full flex-col text-sm">
    <div class="min-h-0 flex-1 overflow-auto">
      <!-- staged -->
      <section v-if="repo.stagedFiles.length" class="px-1">
        <h3
          class="sticky top-0 z-10 bg-background px-2 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ t('changes.staged') }} ({{ repo.stagedFiles.length }})
        </h3>
        <FileRow
          v-for="f in repo.stagedFiles"
          :key="`s-${f.path}`"
          :path="f.path"
          :status="letter(f, true)"
          :active="isSelected(f.path, true)"
          @select="repo.selectFile(f.path, true)"
        >
          <template #actions>
            <UiTooltip>
              <UiTooltipTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  @click.stop="repo.unstage(f.path)"
                >
                  <NuxtIcon name="lucide:minus" class="size-3.5" />
                </UiButton>
              </UiTooltipTrigger>
              <UiTooltipContent>{{ t('changes.unstage') }}</UiTooltipContent>
            </UiTooltip>
          </template>
        </FileRow>
      </section>

      <!-- unstaged / untracked -->
      <section v-if="repo.unstagedFiles.length" class="px-1">
        <h3
          class="sticky top-0 z-10 bg-background px-2 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ t('changes.unstaged') }} ({{ repo.unstagedFiles.length }})
        </h3>
        <FileRow
          v-for="f in repo.unstagedFiles"
          :key="`u-${f.path}`"
          :path="f.path"
          :status="letter(f, false)"
          :active="isSelected(f.path, false)"
          @select="repo.selectFile(f.path, false)"
        >
          <template #actions>
            <UiTooltip>
              <UiTooltipTrigger as-child>
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-5 opacity-0 group-hover:opacity-100"
                  @click.stop="repo.discard(f.path, f.untracked)"
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
                  @click.stop="repo.stage(f.path)"
                >
                  <NuxtIcon name="lucide:plus" class="size-3.5" />
                </UiButton>
              </UiTooltipTrigger>
              <UiTooltipContent>{{ t('changes.stage') }}</UiTooltipContent>
            </UiTooltip>
          </template>
        </FileRow>
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
        :placeholder="t('changes.commitPlaceholder')"
        class="w-full resize-none rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <UiButton
        class="mt-2 w-full"
        size="sm"
        :disabled="!repo.stagedFiles.length || !repo.commitMessage.trim()"
        @click="repo.commit()"
      >
        {{ t('changes.commit') }} ({{ repo.stagedFiles.length }})
      </UiButton>
    </div>
  </div>
</template>
