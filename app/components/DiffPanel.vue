<script setup lang="ts">
import { DiffModeEnum, DiffView } from '@git-diff-view/vue';
import '@git-diff-view/vue/styles/diff-view.css';

const repo = useRepoStore();
const layout = useLayoutStore();
const colorMode = useColorMode();
const { t } = useI18n();

const viewMode = computed(() =>
  layout.diffMode === 'unified' ? DiffModeEnum.Unified : DiffModeEnum.Split
);

const diffData = computed(() =>
  repo.diff
    ? {
        oldFile: {
          fileName: repo.diff.fileName,
          content: repo.diff.oldContent
        },
        newFile: {
          fileName: repo.diff.fileName,
          content: repo.diff.newContent
        },
        hunks: repo.diff.hunks
      }
    : undefined
);
</script>

<template>
  <div class="flex h-full flex-col">
    <header
      class="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3"
    >
      <div class="min-w-0">
        <h2 class="text-sm font-semibold">{{ t('diff.title') }}</h2>
        <code
          v-if="repo.diff"
          class="block truncate text-xs text-muted-foreground"
        >
          {{ repo.diff.fileName }}
        </code>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <UiButton
          :variant="layout.diffMode === 'split' ? 'secondary' : 'ghost'"
          size="sm"
          @click="layout.setDiffMode('split')"
        >
          {{ t('diff.sideBySide') }}
        </UiButton>
        <UiButton
          :variant="layout.diffMode === 'unified' ? 'secondary' : 'ghost'"
          size="sm"
          @click="layout.setDiffMode('unified')"
        >
          {{ t('diff.unified') }}
        </UiButton>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-auto text-sm">
      <DiffView
        v-if="diffData"
        :data="diffData"
        :diff-view-mode="viewMode"
        :diff-view-theme="colorMode.value === 'dark' ? 'dark' : 'light'"
        diff-view-highlight
        diff-view-wrap
      />
      <p v-else class="p-6 text-muted-foreground">
        {{ t('diff.noSelection') }}
      </p>
    </div>
  </div>
</template>
