<script setup lang="ts">
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
  { command: 'fetch' as const, icon: 'lucide:download', label: 'sync.fetch' },
  { command: 'pull' as const, icon: 'lucide:arrow-down', label: 'sync.pull' },
  { command: 'push' as const, icon: 'lucide:arrow-up', label: 'sync.push' }
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
                <NuxtIcon :name="b.icon" class="size-4" />
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
            <NuxtIcon name="lucide:refresh-cw" class="size-3.5" />
            {{ t('actions.refresh') }}
          </UiButton>
          <ThemeToggle />
        </div>
      </header>

      <div v-if="repo.lastError" class="shrink-0 px-3 pt-2">
        <UiAlert
          variant="destructive"
          class="grid-cols-[1rem_1fr] gap-x-3 pr-9"
        >
          <NuxtIcon name="lucide:circle-alert" class="size-4 translate-y-0.5" />
          <UiAlertTitle>{{ t('error.title') }}</UiAlertTitle>
          <UiAlertDescription class="break-words whitespace-pre-wrap">
            {{ repo.lastError }}
          </UiAlertDescription>
          <UiButton
            variant="ghost"
            size="icon"
            class="absolute top-2 right-2 size-6 text-destructive hover:bg-destructive/10"
            @click="repo.clearError()"
          >
            <NuxtIcon name="lucide:x" class="size-4" />
          </UiButton>
        </UiAlert>
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
