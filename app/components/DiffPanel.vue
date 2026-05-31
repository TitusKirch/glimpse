<script setup lang="ts">
const repo = useRepoStore();
const layout = useLayoutStore();
const { t } = useI18n();
</script>

<template>
  <div class="flex h-full flex-col">
    <header
      class="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3"
    >
      <div class="min-w-0">
        <code v-if="repo.diff" class="block truncate text-sm font-medium">{{
          repo.diff.fileName
        }}</code>
        <span v-else class="text-sm font-semibold text-muted-foreground">{{
          t('diff.title')
        }}</span>
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

    <!-- commit detail: full message + author/date -->
    <div
      v-if="repo.selectedHash && repo.selectedCommit"
      class="shrink-0 border-b px-4 py-3"
    >
      <pre
        class="max-h-40 overflow-auto font-sans text-sm leading-relaxed break-words whitespace-pre-wrap"
        >{{ repo.selectedBody || repo.selectedCommit.subject }}</pre
      >
      <div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <NuxtIcon name="lucide:user" class="size-3.5" />
        <span>{{ repo.selectedCommit.author }}</span>
        <span>·</span>
        <span>{{ repo.selectedCommit.date }}</span>
        <code class="ml-auto font-mono">{{
          repo.selectedCommit.hash.slice(0, 7)
        }}</code>
      </div>
    </div>

    <!-- commit: resizable file list (top) / diff (bottom) -->
    <UiResizablePanelGroup
      v-if="repo.selectedHash && repo.commitFiles.length"
      direction="vertical"
      class="min-h-0 flex-1"
    >
      <UiResizablePanel :default-size="30" :min-size="10">
        <div class="flex h-full flex-col text-sm">
          <FileViewToggle class="border-b" />
          <div class="min-h-0 flex-1 overflow-auto px-1 py-1">
            <FileTree
              :files="repo.commitFiles"
              :view="layout.fileView"
              :selected="repo.selectedFile"
              @select="repo.selectCommitFile"
            />
          </div>
        </div>
      </UiResizablePanel>
      <UiResizableHandle />
      <UiResizablePanel :default-size="70" :min-size="20">
        <CodeDiff
          v-if="repo.diff && repo.diff.hunks.length"
          :hunks="repo.diff.hunks"
          :mode="layout.diffMode"
          :file-name="repo.diff.fileName"
        />
        <p v-else class="p-6 text-sm text-muted-foreground">
          {{ t('diff.noSelection') }}
        </p>
      </UiResizablePanel>
    </UiResizablePanelGroup>

    <!-- working file: just the diff -->
    <div v-else class="min-h-0 flex-1">
      <CodeDiff
        v-if="repo.diff && repo.diff.hunks.length"
        :hunks="repo.diff.hunks"
        :mode="layout.diffMode"
        :file-name="repo.diff.fileName"
      />
      <p v-else class="p-6 text-sm text-muted-foreground">
        {{ t('diff.noSelection') }}
      </p>
    </div>
  </div>
</template>
