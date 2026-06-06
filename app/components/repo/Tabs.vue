<script setup lang="ts">
import draggable from 'vuedraggable';
import type { RepoState } from '@/stores/repo';

const repo = useRepoStore();
const openRepoDialog = useOverlay('openRepo');
const { t } = useI18n();

// Dismiss the "+" button's tooltip as the open-repo dialog appears, so it
// doesn't linger on the focused trigger over the dialog.
const { open: openRepoTip, onActivate: onOpenRepo } = useDismissableTooltip();

// Suppress tooltips (e.g. a tab's WSL-distro tooltip) while a tab reorder drag
// is in flight, so the pointer sweeping over tabs doesn't pop them mid-drag.
const { startReorder, endReorder } = useDragReorder();

// Map a WSL distro name to its brand icon (simple-icons), falling back to the
// generic Tux penguin when the distro isn't recognised.
function distroIcon(distro?: string): string {
  const d = (distro ?? '').toLowerCase();
  if (d.includes('ubuntu')) return 'simple-icons:ubuntu';
  if (d.includes('debian')) return 'simple-icons:debian';
  if (d.includes('arch')) return 'simple-icons:archlinux';
  if (d.includes('fedora')) return 'simple-icons:fedora';
  if (d.includes('suse')) return 'simple-icons:opensuse';
  if (d.includes('kali')) return 'simple-icons:kalilinux';
  if (d.includes('alpine')) return 'simple-icons:alpinelinux';
  if (d.includes('mint')) return 'simple-icons:linuxmint';
  return 'simple-icons:linux';
}

// While a freshly opened WSL tab is still resolving (distro not known, not yet
// loaded), show a spinner instead of flashing the generic penguin before the
// real distro icon arrives.
function isResolvingDistro(tab: RepoState): boolean {
  return !tab.distro && !tab.loaded;
}
function tabDistroIcon(tab: RepoState): string {
  return isResolvingDistro(tab)
    ? 'lucide:loader-circle'
    : distroIcon(tab.distro);
}

// Reorder via SortableJS (vuedraggable). `forceFallback` makes it drive the drag
// with its own pointer-based fallback instead of the native HTML5 Drag-and-Drop
// API. SortableJS uses native DnD by default, but the Windows WebView2 release
// build's OS-level drag handler swallows those events, so reordering silently
// dies there (it still works in the browser and the WebKitGTK `tauri dev` shell).
// `fallbackTolerance` keeps a plain click on a tab from registering as a drag.
// Persist the new order by its ids.
function onReorder(tabs: RepoState[]) {
  repo.reorderTabs(tabs.map((tab) => tab.id));
}
</script>

<template>
  <div class="flex items-center gap-1">
    <draggable
      :model-value="repo.tabs"
      item-key="id"
      tag="div"
      class="flex items-center gap-1"
      :animation="150"
      :force-fallback="true"
      :fallback-tolerance="3"
      ghost-class="opacity-50"
      filter=".tab-close"
      :prevent-on-filter="false"
      @start="startReorder"
      @end="endReorder"
      @update:model-value="onReorder"
    >
      <template #item="{ element: tab }">
        <div
          class="group flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-1 pl-3 text-sm transition-colors select-none"
          :class="
            tab.id === repo.activeTabId
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50'
          "
          @click="repo.selectTab(tab.id)"
        >
          <span>{{ tab.name }}</span>
          <UiTooltip v-if="tab.flavor === 'wsl'">
            <UiTooltipTrigger as-child>
              <NuxtIcon
                :name="tabDistroIcon(tab)"
                class="size-3.5 shrink-0 text-muted-foreground"
                :class="isResolvingDistro(tab) && 'animate-spin'"
              />
            </UiTooltipTrigger>
            <UiTooltipContent>{{
              tab.distro
                ? `${t('platform.wsl')}: ${tab.distro}`
                : t('platform.wsl')
            }}</UiTooltipContent>
          </UiTooltip>
          <button
            class="tab-close flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-background/60"
            :class="
              tab.id === repo.activeTabId
                ? 'opacity-70 hover:opacity-100'
                : 'opacity-0 group-hover:opacity-100'
            "
            :aria-label="t('actions.closeRepo')"
            @click.stop="repo.closeRepo(tab.id)"
          >
            <NuxtIcon name="lucide:x" class="size-3.5" />
          </button>
        </div>
      </template>
    </draggable>

    <UiTooltip v-model:open="openRepoTip">
      <UiTooltipTrigger as-child>
        <UiButton
          variant="ghost"
          size="icon"
          class="size-7"
          icon="lucide:plus"
          :aria-label="t('actions.openRepo')"
          @click="onOpenRepo(() => openRepoDialog.show())"
        />
      </UiTooltipTrigger>
      <UiTooltipContent>{{ t('actions.openRepo') }}</UiTooltipContent>
    </UiTooltip>
  </div>
</template>
