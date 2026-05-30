<script setup lang="ts">
import type { StatusEntry } from '@/stores/repo';

const repo = useRepoStore();
const { t } = useI18n();

function letter(f: StatusEntry, staged: boolean): string {
  if (f.untracked) return 'U';
  return (staged ? f.x : f.y).trim() || '·';
}

function letterClass(l: string): string {
  return (
    {
      M: 'text-amber-500',
      A: 'text-green-500',
      D: 'text-red-500',
      U: 'text-blue-500',
      R: 'text-purple-500'
    }[l] || 'text-muted-foreground'
  );
}

function isSelected(path: string, staged: boolean): boolean {
  return repo.selectedFile === path && repo.selectedFileStaged === staged;
}
</script>

<template>
  <div class="flex h-full flex-col text-sm">
    <div class="min-h-0 flex-1 overflow-auto">
      <!-- staged -->
      <section v-if="repo.stagedFiles.length">
        <h3
          class="sticky top-0 bg-background px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ t('changes.staged') }} ({{ repo.stagedFiles.length }})
        </h3>
        <button
          v-for="f in repo.stagedFiles"
          :key="`s-${f.path}`"
          class="group flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent/50"
          :class="isSelected(f.path, true) && 'bg-accent'"
          @click="repo.selectFile(f.path, true)"
        >
          <span
            class="w-3 text-center font-mono text-xs"
            :class="letterClass(letter(f, true))"
            >{{ letter(f, true) }}</span
          >
          <span class="min-w-0 flex-1 truncate">{{ f.path }}</span>
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
        </button>
      </section>

      <!-- unstaged / untracked -->
      <section v-if="repo.unstagedFiles.length">
        <h3
          class="sticky top-0 bg-background px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ t('changes.unstaged') }} ({{ repo.unstagedFiles.length }})
        </h3>
        <button
          v-for="f in repo.unstagedFiles"
          :key="`u-${f.path}`"
          class="group flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent/50"
          :class="isSelected(f.path, false) && 'bg-accent'"
          @click="repo.selectFile(f.path, false)"
        >
          <span
            class="w-3 text-center font-mono text-xs"
            :class="letterClass(letter(f, false))"
            >{{ letter(f, false) }}</span
          >
          <span class="min-w-0 flex-1 truncate">{{ f.path }}</span>
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
        </button>
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
