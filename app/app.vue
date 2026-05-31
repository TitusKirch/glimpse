<script setup lang="ts">
import { listen } from '@tauri-apps/api/event';
import { toast } from 'vue-sonner';
import { Sonner as UiSonner } from '@/components/ui/sonner';

const repo = useRepoStore();
const layout = useLayoutStore();
const { t } = useI18n();

// Surface git failures as a toast instead of a persistent banner.
watch(
  () => repo.lastError,
  (err) => {
    if (!err) return;
    toast.error(t('error.title'), { description: err });
    repo.clearError();
  }
);

// Load real git data when running inside the desktop shell (mock in browser).
// Refresh-on-focus fallback (the best-effort FS watcher may miss WSL events).
let unlisten: (() => void) | undefined;
onMounted(async () => {
  void repo.loadFromBackend();
  window.addEventListener('focus', repo.refresh);
  // Live-refresh on filesystem changes emitted by the Rust watcher.
  if (isTauri()) {
    unlisten = await listen('repo-changed', () => void repo.reloadActive());
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('focus', repo.refresh);
  unlisten?.();
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
                :loading="repo.syncing === b.command"
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
            :disabled="repo.busy || repo.refreshing"
            @click="repo.refresh"
          >
            <NuxtIcon
              name="lucide:refresh-cw"
              class="size-3.5"
              :class="repo.refreshing && 'animate-spin'"
            />
            {{ t('actions.refresh') }}
          </UiButton>
          <ThemeToggle />
        </div>
      </header>

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
        <UiResizableHandle class="z-30" />
        <UiResizablePanel :default-size="layout.panelSizes[1]" :min-size="25">
          <DiffPanel />
        </UiResizablePanel>
      </UiResizablePanelGroup>
    </UiSidebarInset>
  </UiSidebarProvider>

  <UiSonner />
</template>
