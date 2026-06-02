<script setup lang="ts">
import { listen } from '@tauri-apps/api/event';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { toast } from 'vue-sonner';
import { Toaster as UiSonner } from '@/components/ui/sonner';

const repo = useRepoStore();
const layout = useLayoutStore();
const settings = useOverlay('settings');
const palette = useOverlay('commandPalette');
const help = useOverlay('help');
const { checkForUpdates } = useUpdater();
const experiments = useExperiments();
const { t, locale } = useI18n();

// First-launch default for the command palette's extra search languages, keyed
// to the startup locale: English UI → none, any other language → also search
// English. No-op once the user has touched the setting (see initSearchLocales).
layout.initSearchLocales(locale.value);

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
  // Experiments are opt-in and manual, so they never auto-update on launch.
  if (layout.autoUpdate && layout.releaseChannel !== 'experiment') {
    void checkForUpdates(false);
  }
  // Populate the experiment list once on boot when that channel is active.
  if (layout.releaseChannel === 'experiment') void experiments.refresh();
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

// Platform-correct modifier glyphs for the shortcut hints in tooltips, matching
// the actual bindings wired in useShortcuts (mod = ⌘ on mac, Ctrl elsewhere).
const isMac = navigator.platform.toLowerCase().includes('mac');
const modKey = isMac ? '⌘' : 'Ctrl';
const shiftKey = isMac ? '⇧' : 'Shift';

const syncButtons = [
  {
    command: 'fetch' as const,
    icon: 'lucide:download',
    label: 'sync.fetch',
    keys: `${modKey}+${shiftKey}+F`
  },
  {
    command: 'pull' as const,
    icon: 'lucide:arrow-down',
    label: 'sync.pull',
    keys: `${modKey}+${shiftKey}+L`
  },
  {
    command: 'push' as const,
    icon: 'lucide:arrow-up',
    label: 'sync.push',
    keys: `${modKey}+${shiftKey}+U`
  }
];

// Count badge on the sync buttons: behind-count on pull, ahead-count on push.
function syncCount(command: string): number {
  if (command === 'pull') return repo.behind;
  if (command === 'push') return repo.ahead;
  return 0;
}
</script>

<template>
  <UiSidebarProvider
    :open="layout.sidebarOpen"
    :width="`${layout.sidebarWidth}px`"
    class="h-screen"
    @update:open="layout.setSidebarOpen"
  >
    <AppSidebar />

    <UiSidebarInset class="flex min-w-0 flex-col overflow-hidden">
      <header class="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <UiTooltip>
          <UiTooltipTrigger as-child>
            <UiSidebarTrigger />
          </UiTooltipTrigger>
          <UiTooltipContent class="flex items-center gap-2">
            <span>{{ t('command.toggleSidebar') }}</span>
            <UiKbd>{{ `${modKey}+B` }}</UiKbd>
          </UiTooltipContent>
        </UiTooltip>
        <div class="h-5 w-px bg-border" />
        <RepoTabs />
        <div class="ml-auto flex items-center gap-1">
          <UiTooltip>
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon"
                icon="lucide:search"
                :disabled="!repo.hasRepos"
                @click="palette.show()"
              />
            </UiTooltipTrigger>
            <UiTooltipContent class="flex items-center gap-2">
              <span>{{ t('command.open') }}</span>
              <UiKbd>{{ `${modKey}+K` }}</UiKbd>
            </UiTooltipContent>
          </UiTooltip>
          <UiTooltip>
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon"
                icon="lucide:keyboard"
                @click="help.show()"
              />
            </UiTooltipTrigger>
            <UiTooltipContent class="flex items-center gap-2">
              <span>{{ t('help.title') }}</span>
              <UiKbd>{{ `${modKey}+/` }}</UiKbd>
            </UiTooltipContent>
          </UiTooltip>
          <UiTooltip v-for="b in syncButtons" :key="b.command">
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                :size="syncCount(b.command) ? 'sm' : 'icon'"
                :icon="b.icon"
                :disabled="repo.busy || !repo.hasRepos"
                :pending="repo.syncing === b.command"
                @click="repo.sync(b.command)"
              >
                <!-- behind-count on pull, ahead-count on push -->
                <span
                  v-if="syncCount(b.command)"
                  class="text-xs font-medium tabular-nums"
                  :class="
                    b.command === 'push' ? 'text-success' : 'text-warning'
                  "
                  >{{ syncCount(b.command) }}</span
                >
              </UiButton>
            </UiTooltipTrigger>
            <UiTooltipContent class="flex items-center gap-2">
              <span>{{ t(b.label) }}</span>
              <UiKbd>{{ b.keys }}</UiKbd>
            </UiTooltipContent>
          </UiTooltip>
          <div class="mx-1 h-5 w-px bg-border" />
          <UiTooltip>
            <UiTooltipTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon"
                icon="lucide:refresh-cw"
                :pending="repo.refreshing"
                :disabled="repo.busy || !repo.hasRepos"
                @click="repo.refresh"
              />
            </UiTooltipTrigger>
            <UiTooltipContent>{{ t('actions.refresh') }}</UiTooltipContent>
          </UiTooltip>
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
        <UiButton
          variant="outline"
          size="sm"
          icon="lucide:refresh-cw"
          @click="repo.retryLoad()"
        >
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
