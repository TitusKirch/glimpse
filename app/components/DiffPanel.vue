<script setup lang="ts">
const repo = useRepoStore();
const layout = useLayoutStore();
const { t } = useI18n();
const copyText = useCopy();
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
      <!-- diff mode toggle — same segmented style as Changes/History -->
      <UiTabs
        :model-value="layout.diffMode"
        class="shrink-0"
        @update:model-value="
          (v) => layout.setDiffMode(v as 'split' | 'unified')
        "
      >
        <UiTabsList class="h-8">
          <UiTabsTrigger value="split" class="text-xs">{{
            t('diff.sideBySide')
          }}</UiTabsTrigger>
          <UiTabsTrigger value="unified" class="text-xs">{{
            t('diff.unified')
          }}</UiTabsTrigger>
        </UiTabsList>
      </UiTabs>
    </header>

    <!-- commit: resizable detail / file list / diff -->
    <UiResizablePanelGroup
      v-if="repo.selectedHash && repo.commitFiles.length"
      direction="vertical"
      class="min-h-0 flex-1"
      @layout="layout.setCommitPanelSizes"
    >
      <UiResizablePanel
        :default-size="layout.commitPanelSizes[0]"
        :min-size="8"
      >
        <div class="h-full overflow-auto px-4 py-3">
          <pre
            class="font-sans text-sm leading-relaxed break-words whitespace-pre-wrap"
            >{{ repo.selectedBody || repo.selectedCommit?.subject }}</pre
          >
          <div
            v-if="repo.selectedCommit"
            class="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
          >
            <NuxtIcon name="lucide:user" class="size-3.5" />
            <span>{{ repo.selectedCommit.author }}</span>
            <span>·</span>
            <span>{{ repo.selectedCommit.date }}</span>
            <code class="ml-auto font-mono">{{
              repo.selectedCommit.hash.slice(0, 7)
            }}</code>
            <UiDropdownMenu>
              <UiDropdownMenuTrigger as-child>
                <UiButton variant="ghost" size="icon" class="size-6">
                  <NuxtIcon name="lucide:ellipsis" class="size-4" />
                </UiButton>
              </UiDropdownMenuTrigger>
              <UiDropdownMenuContent align="end">
                <UiDropdownMenuItem
                  @click="repo.checkoutCommit(repo.selectedCommit!.hash)"
                >
                  <NuxtIcon name="lucide:git-commit-horizontal" />
                  {{ t('commit.checkout') }}
                </UiDropdownMenuItem>
                <UiDropdownMenuItem
                  @click="copyText(repo.selectedCommit!.hash)"
                >
                  <NuxtIcon name="lucide:copy" />
                  {{ t('commit.copyHash') }}
                </UiDropdownMenuItem>
              </UiDropdownMenuContent>
            </UiDropdownMenu>
          </div>
        </div>
      </UiResizablePanel>
      <UiResizableHandle />
      <UiResizablePanel
        :default-size="layout.commitPanelSizes[1]"
        :min-size="10"
      >
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
      <UiResizablePanel
        :default-size="layout.commitPanelSizes[2]"
        :min-size="20"
      >
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
      <div v-else-if="repo.loading" class="space-y-2 p-4">
        <UiSkeleton
          v-for="n in 12"
          :key="n"
          class="h-4"
          :style="{ width: 30 + ((n * 13) % 65) + '%' }"
        />
      </div>
      <EmptyState
        v-else
        icon="lucide:file-diff"
        :title="t('diff.noSelection')"
      />
    </div>
  </div>
</template>
