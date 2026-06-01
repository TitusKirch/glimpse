<script setup lang="ts">
import { listen } from '@tauri-apps/api/event';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { toast } from 'vue-sonner';
import { Toaster as UiSonner } from '@/components/ui/sonner';

const repo = useRepoStore();
const layout = useLayoutStore();
const settings = useSettingsDialog();
const palette = useCommandPalette();
const help = useHelpDialog();
const { checkForUpdates } = useUpdater();
const { t } = useI18n();

// Cross-cutting app behaviour: apply appearance settings, wire global keyboard
// shortcuts, and run the optional auto-fetch loop.
useAppearance();
useShortcuts();
useAutoFetch();
useModalScrollLock();

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
let unlistenDeepLink: (() => void) | undefined;
onMounted(async () => {
  void repo.restoreSession();
  window.addEventListener('focus', repo.refresh);
  // Silently check for app updates on launch (auto-installs when found); a
  // no-op until the updater is configured with a real signing key + endpoint.
  if (layout.autoUpdate) void checkForUpdates(false);
  // Live-refresh on filesystem changes emitted by the Rust watcher.
  if (isTauri()) {
    unlisten = await listen('repo-changed', () => void repo.reloadActive());
    // glimpse://open?path=/abs or glimpse:///abs -> open that repo.
    unlistenDeepLink = await onOpenUrl((urls) => {
      for (const u of urls) {
        try {
          const url = new URL(u);
          const path =
            url.searchParams.get('path') ||
            decodeURIComponent(url.pathname || url.hostname);
          if (path) void repo.openRepo(path);
        } catch {
          // ignore malformed deep links
        }
      }
    });
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('focus', repo.refresh);
  unlisten?.();
  unlistenDeepLink?.();
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
          <UiTooltip>
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon"
                :disabled="!repo.hasRepos"
                @click="palette.show()"
              >
                <NuxtIcon name="lucide:search" class="size-4" />
              </UiButton>
            </UiTooltipTrigger>
            <UiTooltipContent>{{ t('command.open') }}</UiTooltipContent>
          </UiTooltip>
          <UiTooltip>
            <UiTooltipTrigger as-child>
              <UiButton variant="ghost" size="icon" @click="help.show()">
                <NuxtIcon name="lucide:keyboard" class="size-4" />
              </UiButton>
            </UiTooltipTrigger>
            <UiTooltipContent>{{ t('help.title') }}</UiTooltipContent>
          </UiTooltip>
          <UiTooltip v-for="b in syncButtons" :key="b.command">
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon"
                class="relative"
                :icon="b.icon"
                :disabled="repo.busy || !repo.hasRepos"
                :pending="repo.syncing === b.command"
                @click="repo.sync(b.command)"
              >
                <!-- behind-upstream indicator on the pull button -->
                <span
                  v-if="b.command === 'pull' && repo.behind"
                  class="absolute -top-0.5 -right-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] leading-none font-semibold text-white"
                  >{{ repo.behind }}</span
                >
              </UiButton>
            </UiTooltipTrigger>
            <UiTooltipContent>{{ t(b.label) }}</UiTooltipContent>
          </UiTooltip>
          <div class="mx-1 h-5 w-px bg-border" />
          <UiButton
            variant="ghost"
            size="sm"
            class="gap-1.5"
            :disabled="repo.busy || repo.refreshing || !repo.hasRepos"
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

      <!-- inline load error with retry (in addition to the toast) -->
      <EmptyState
        v-if="repo.hasRepos && repo.loadError"
        icon="lucide:circle-alert"
        :title="t('error.loadFailed')"
        :description="repo.loadError"
        class="min-h-0 flex-1"
      >
        <UiButton variant="outline" size="sm" @click="repo.retryLoad()">
          <NuxtIcon name="lucide:refresh-cw" class="size-4" />
          {{ t('error.retry') }}
        </UiButton>
      </EmptyState>

      <StartScreen v-else-if="!repo.hasRepos" class="min-h-0 flex-1" />

      <UiResizablePanelGroup
        v-else
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

  <CommandPalette />
  <SettingsDialog v-model:open="settings.open.value" />
  <ConfirmDialog />
  <PromptDialog />
  <HelpDialog />
  <AddRemoteDialog />
  <OpenRepoDialog />
  <UiSonner />
</template>
