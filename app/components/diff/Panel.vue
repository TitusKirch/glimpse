<script setup lang="ts">
const repo = useRepoStore();
const layout = useLayoutStore();
const settings = useSettingsStore();
const { t } = useI18n();
const copyText = useCopy();

const historyOpen = ref(false);
const blame = ref(false);

// Blame only applies to a working file (not a commit diff). Reset when the
// selection changes to a commit.
const canBlame = computed(() => !!repo.selectedFile && !repo.selectedHash);
watch(canBlame, (ok) => {
  if (!ok) blame.value = false;
});

function toggleWhitespace() {
  layout.ignoreWhitespace = !layout.ignoreWhitespace;
  void repo.reDiff();
}

// Whole-file view reuses the unified layout but is fetched with full context;
// switching into/out of it changes the context, so it needs a re-diff.
const effectiveMode = computed(() =>
  settings.diffMode === 'whole' ? 'unified' : settings.diffMode
);
const hideHunkHeader = computed(() => settings.diffMode === 'whole');
function setMode(v: string) {
  const crossesWhole = (v === 'whole') !== (settings.diffMode === 'whole');
  settings.setDiffMode(v as 'split' | 'unified' | 'whole');
  if (crossesWhole) void repo.reDiff();
}
function copyDiff() {
  if (repo.diff) void copyText(repo.diff.hunks.join('\n'));
}
function copyPath() {
  if (repo.diff) void copyText(repo.diff.fileName);
}
// Stage the hunk from an unstaged file, or unstage it from a staged file
// (reverse patch).
function onStageHunk(hunk: string) {
  if (repo.selectedFile) {
    void repo.applyHunk({
      file: repo.selectedFile,
      hunk,
      reverse: repo.selectedFileStaged
    });
  }
}
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
        <template v-if="repo.diff">
          <UiTooltip v-if="canBlame">
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon-sm"
                icon="lucide:user-round-search"
                :class="blame && 'text-primary'"
                @click="blame = !blame"
              />
            </UiTooltipTrigger>
            <UiTooltipContent>{{ t('diff.blame') }}</UiTooltipContent>
          </UiTooltip>
          <UiTooltip>
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon-sm"
                icon="lucide:pilcrow"
                :class="layout.ignoreWhitespace && 'text-primary'"
                @click="toggleWhitespace"
              />
            </UiTooltipTrigger>
            <UiTooltipContent>{{
              t('diff.ignoreWhitespace')
            }}</UiTooltipContent>
          </UiTooltip>
          <UiTooltip>
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon-sm"
                icon="lucide:history"
                @click="historyOpen = true"
              />
            </UiTooltipTrigger>
            <UiTooltipContent>{{ t('diff.fileHistory') }}</UiTooltipContent>
          </UiTooltip>
          <UiDropdownMenu>
            <UiDropdownMenuTrigger as-child>
              <UiButton variant="ghost" size="icon-sm" icon="lucide:copy" />
            </UiDropdownMenuTrigger>
            <UiDropdownMenuContent align="end">
              <UiDropdownMenuItem @click="copyPath">
                <NuxtIcon name="lucide:file" />
                {{ t('diff.copyPath') }}
              </UiDropdownMenuItem>
              <UiDropdownMenuItem @click="copyDiff">
                <NuxtIcon name="lucide:file-diff" />
                {{ t('diff.copyDiff') }}
              </UiDropdownMenuItem>
            </UiDropdownMenuContent>
          </UiDropdownMenu>
        </template>

        <!-- diff mode toggle — same segmented style as Changes/History -->
        <UiTabs
          :model-value="settings.diffMode"
          @update:model-value="(v) => setMode(v as string)"
        >
          <UiTabsList class="h-8">
            <UiTabsTrigger value="split" class="text-xs">{{
              t('diff.sideBySide')
            }}</UiTabsTrigger>
            <UiTabsTrigger value="unified" class="text-xs">{{
              t('diff.unified')
            }}</UiTabsTrigger>
            <UiTabsTrigger value="whole" class="text-xs">{{
              t('diff.whole')
            }}</UiTabsTrigger>
          </UiTabsList>
        </UiTabs>
      </div>
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
                <UiButton
                  variant="ghost"
                  size="icon"
                  class="size-6"
                  icon="lucide:ellipsis"
                />
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
              :view="settings.fileView"
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
          :mode="effectiveMode"
          :hide-hunk-header="hideHunkHeader"
          :file-name="repo.diff.fileName"
          :old-content="repo.diff.oldContent"
          :new-content="repo.diff.newContent"
        />
        <p v-else class="p-6 text-sm text-muted-foreground">
          {{ repo.selectedFile ? t('diff.noTextDiff') : t('diff.noSelection') }}
        </p>
      </UiResizablePanel>
    </UiResizablePanelGroup>

    <!-- working file: blame or diff -->
    <div v-else class="min-h-0 flex-1">
      <BlameView
        v-if="blame && canBlame && repo.selectedFile"
        :file="repo.selectedFile"
      />
      <CodeDiff
        v-else-if="repo.diff && repo.diff.hunks.length"
        :hunks="repo.diff.hunks"
        :mode="effectiveMode"
        :hide-hunk-header="hideHunkHeader"
        :file-name="repo.diff.fileName"
        :old-content="repo.diff.oldContent"
        :new-content="repo.diff.newContent"
        :hunk-action="repo.selectedFileStaged ? 'unstage' : 'stage'"
        @stage-hunk="onStageHunk"
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

  <FileHistoryDialog v-model:open="historyOpen" :file="repo.selectedFile" />
</template>
