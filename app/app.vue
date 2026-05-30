<script setup lang="ts">
import { ArrowDown, ArrowUp, Download, RefreshCw, X } from '@lucide/vue';

const repo = useRepoStore();
const layout = useLayoutStore();
const { t } = useI18n();

// Load real git data when running inside the desktop shell (mock in browser).
// Refresh-on-focus fallback (the best-effort FS watcher may miss WSL events).
onMounted(() => {
  void repo.loadFromBackend();
  window.addEventListener('focus', repo.refresh);
});
onBeforeUnmount(() => {
  window.removeEventListener('focus', repo.refresh);
});

const syncButtons = [
  { command: 'fetch' as const, icon: Download, label: 'sync.fetch' },
  { command: 'pull' as const, icon: ArrowDown, label: 'sync.pull' },
  { command: 'push' as const, icon: ArrowUp, label: 'sync.push' }
];
</script>

<template>
  <UiSidebarProvider
    :open="layout.sidebarOpen"
    class="h-screen"
    @update:open="layout.setSidebarOpen"
  >
    <AppSidebar />

    <UiSidebarInset class="flex min-w-0 flex-col overflow-hidden">
      <header class="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <UiSidebarTrigger />
        <div class="h-5 w-px bg-border" />
        <RepoTabs />
        <div class="ml-auto flex items-center gap-1">
          <UiTooltip v-for="b in syncButtons" :key="b.command">
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon"
                :disabled="repo.busy"
                @click="repo.sync(b.command)"
              >
                <component :is="b.icon" class="size-4" />
              </UiButton>
            </UiTooltipTrigger>
            <UiTooltipContent>{{ t(b.label) }}</UiTooltipContent>
          </UiTooltip>
          <div class="mx-1 h-5 w-px bg-border" />
          <UiButton
            variant="ghost"
            size="sm"
            class="gap-1.5"
            :disabled="repo.busy"
            @click="repo.refresh"
          >
            <RefreshCw class="size-3.5" /> {{ t('actions.refresh') }}
          </UiButton>
          <ThemeToggle />
        </div>
      </header>

      <div
        v-if="repo.lastError"
        class="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
      >
        <span class="min-w-0 flex-1 break-words whitespace-pre-wrap">{{
          repo.lastError
        }}</span>
        <button class="shrink-0 hover:opacity-70" @click="repo.clearError()">
          <X class="size-3.5" />
        </button>
      </div>

      <UiResizablePanelGroup
        direction="horizontal"
        class="min-h-0 flex-1"
        @layout="layout.setPanelSizes"
      >
        <UiResizablePanel :default-size="layout.panelSizes[0]" :min-size="25">
          <UiTabs
            :model-value="layout.leftTab"
            class="flex h-full flex-col gap-0"
            @update:model-value="
              (v) => layout.setLeftTab(v as 'changes' | 'history')
            "
          >
            <div class="flex h-12 shrink-0 items-center border-b px-2">
              <UiTabsList class="grid w-full grid-cols-2">
                <UiTabsTrigger value="changes">{{
                  t('changes.title')
                }}</UiTabsTrigger>
                <UiTabsTrigger value="history">{{
                  t('history.title')
                }}</UiTabsTrigger>
              </UiTabsList>
            </div>
            <UiTabsContent value="changes" class="mt-0 min-h-0 flex-1">
              <ChangesPanel />
            </UiTabsContent>
            <UiTabsContent value="history" class="mt-0 min-h-0 flex-1">
              <CommitGraph />
            </UiTabsContent>
          </UiTabs>
        </UiResizablePanel>
        <UiResizableHandle with-handle />
        <UiResizablePanel :default-size="layout.panelSizes[1]" :min-size="25">
          <DiffPanel />
        </UiResizablePanel>
      </UiResizablePanelGroup>
    </UiSidebarInset>
  </UiSidebarProvider>
</template>
