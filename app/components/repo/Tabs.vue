<script setup lang="ts">
import draggable from 'vuedraggable';
import type { RepoState } from '@/stores/repo';

const repo = useRepoStore();
const openRepoDialog = useOverlay('openRepo');
const { t } = useI18n();

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

// Reorder via SortableJS (vuedraggable): it drives the drag with mouse/pointer
// events, so it works inside the Tauri webview where native HTML5 drag-and-drop
// is intercepted by the OS drag handler. Persist the new order by its ids.
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
      ghost-class="opacity-50"
      filter=".tab-close"
      :prevent-on-filter="false"
      @update:model-value="onReorder"
    >
      <template #item="{ element: tab }">
        <div
          class="group flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-1 pl-3 text-sm transition-colors"
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
                :name="distroIcon(tab.distro)"
                class="size-3.5 shrink-0 text-muted-foreground"
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

    <UiTooltip>
      <UiTooltipTrigger as-child>
        <UiButton
          variant="ghost"
          size="icon"
          class="size-7"
          icon="lucide:plus"
          @click="openRepoDialog.show()"
        />
      </UiTooltipTrigger>
      <UiTooltipContent>{{ t('actions.openRepo') }}</UiTooltipContent>
    </UiTooltip>
  </div>
</template>
