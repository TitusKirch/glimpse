<script setup lang="ts">
import draggable from 'vuedraggable';
import { useSidebar } from '@/components/ui/sidebar';

const repo = useRepoStore();
const settings = useOverlay('settings');
const openRepoDialog = useOverlay('openRepo');
const help = useOverlay('help');
const { t } = useI18n();

// Build-identity tag next to the app name: the experiment name on an experiment
// build, else BETA on a pre-release. Hidden on stable/dev. Reflects the *running
// build*, not the updater channel setting.
const { isBeta, isExperiment, experiment } = useAppVersion();

// Collapsed (icon-only) sidebar: items open a dropdown instead of acting
// directly, so their actions stay reachable.
const { state, isMobile } = useSidebar();
const isCollapsed = computed(
  () => state.value === 'collapsed' && !isMobile.value
);

const layout = useLayoutStore();
const settingsStore = useSettingsStore();
// Drag-to-resize the expanded sidebar within [12rem, 32rem] (default 16rem).
// Width persists in the settings store and feeds --sidebar-width via the
// provider. Transitions are suppressed (body class) during the drag so it
// tracks the pointer crisply.
const MIN_WIDTH = 192;
const MAX_WIDTH = 512;
const canResize = computed(
  () =>
    settingsStore.sidebarResizable &&
    state.value === 'expanded' &&
    !isMobile.value
);
function startResize(e: PointerEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = settingsStore.sidebarWidth;
  document.body.classList.add('resizing-sidebar');
  const onMove = (ev: PointerEvent) => {
    const next = startWidth + (ev.clientX - startX);
    settingsStore.sidebarWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
  };
  const onUp = () => {
    document.body.classList.remove('resizing-sidebar');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// Sidebar sections render in the user's persisted order; each can be collapsed,
// and in edit mode dragged by its handle to reorder. By default every section
// participates and an empty one shows a "none yet" line; with "hide empty
// sections" on, a loaded-empty section drops out entirely. Sections stay visible
// during the first load so their skeleton can show; on a refresh they're already
// loaded, so an empty hidden section stays hidden instead of popping in and out. A
// reorder of the visible subset is merged back into the full order with the hidden
// sections pinned to their slots.
function sectionVisible(count: number): boolean {
  if (repo.loading && !repo.loaded) return true;
  return settingsStore.hideEmptySidebarSections ? count > 0 : true;
}
const SECTION_VISIBLE: Record<string, () => boolean> = {
  branches: () => sectionVisible(repo.branches.length),
  remotes: () => sectionVisible(repo.remotes.length),
  remoteBranches: () => sectionVisible(repo.remoteBranches.length),
  tags: () => sectionVisible(repo.tags.length),
  stashes: () => sectionVisible(repo.stashes.length)
};
const visibleSections = computed(() =>
  layout.sidebarSectionOrder.filter((id) => SECTION_VISIBLE[id]?.() ?? false)
);
const sectionKey = (id: string) => id;
function onReorderSections(next: string[]) {
  const moved = new Set(next);
  let i = 0;
  const merged = layout.sidebarSectionOrder.map((id) =>
    moved.has(id) ? next[i++]! : id
  );
  layout.reorderSidebarSections(merged);
}

// Suppress item tooltips while a section reorder drag is in flight, so the
// pointer sweeping over branch/tag/stash rows doesn't pop their tooltips.
const { startReorder, endReorder } = useDragReorder();

// External links pinned to the bottom of the sidebar.
const links = [
  {
    title: 'GitHub',
    url: 'https://github.com/TitusKirch/glimpse',
    icon: 'simple-icons:github'
  },
  {
    title: 'Discord',
    url: 'https://discord.gg/cwFp2nx',
    icon: 'simple-icons:discord'
  },
  {
    title: 'Report a bug',
    url: 'https://github.com/TitusKirch/glimpse/issues',
    icon: 'lucide:bug'
  }
];
</script>

<template>
  <UiSidebar collapsible="icon" class="select-none">
    <UiSidebarHeader>
      <div
        class="flex h-8 items-center gap-2 overflow-hidden text-sm font-bold"
      >
        <img src="/logo_128x128.png" alt="" class="size-8 shrink-0" />
        <span class="truncate">{{ t('app.name') }}</span>
        <UiBadge
          v-if="isExperiment"
          variant="destructive"
          icon="lucide:flask-conical"
          :title="experiment ?? undefined"
          class="group-data-[collapsible=icon]:hidden"
        >
          {{ t('sidebar.experimentBadge') }}
        </UiBadge>
        <UiBadge
          v-else-if="isBeta"
          variant="warning"
          icon="lucide:rocket"
          class="group-data-[collapsible=icon]:hidden"
        >
          BETA
        </UiBadge>
      </div>
    </UiSidebarHeader>

    <UiSidebarContent>
      <!-- no repo open: prompt to open one instead of empty branch lists -->
      <div
        v-if="!repo.hasRepos"
        class="p-2 group-data-[collapsible=icon]:hidden"
      >
        <UiAlert>
          <UiAlertTitle>{{ t('sidebar.noRepo.title') }}</UiAlertTitle>
          <UiAlertDescription>{{
            t('sidebar.noRepo.hint')
          }}</UiAlertDescription>
        </UiAlert>
        <UiButton
          size="sm"
          class="mt-2 w-full"
          icon="lucide:folder-open"
          @click="openRepoDialog.show()"
        >
          {{ t('actions.openRepo') }}
        </UiButton>
      </div>

      <template v-else>
        <!-- Edit mode: a dashed hint with a quick way back out. Reordering is
             driven by the per-section drag handles. -->
        <div
          v-if="layout.sidebarEditMode"
          class="mx-2 mt-2 mb-1 flex items-start justify-between gap-2 rounded-md border border-dashed border-sidebar-border px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
        >
          <span>{{ t('sidebar.editMode.hint') }}</span>
          <UiButton
            size="sm"
            variant="ghost"
            class="h-6 shrink-0 px-2"
            @click="layout.setSidebarEditMode(false)"
          >
            {{ t('sidebar.editMode.done') }}
          </UiButton>
        </div>

        <draggable
          :model-value="visibleSections"
          :item-key="sectionKey"
          tag="div"
          handle=".sidebar-section-handle"
          :disabled="!layout.sidebarEditMode || isCollapsed"
          :force-fallback="true"
          :fallback-tolerance="3"
          :animation="150"
          ghost-class="opacity-50"
          @start="startReorder"
          @end="endReorder"
          @update:model-value="onReorderSections"
        >
          <template #item="{ element: id }">
            <SidebarSectionBranches v-if="id === 'branches'" />
            <SidebarSectionRemotes v-else-if="id === 'remotes'" />
            <SidebarSectionRemoteBranches v-else-if="id === 'remoteBranches'" />
            <SidebarSectionTags v-else-if="id === 'tags'" />
            <SidebarSectionStashes v-else-if="id === 'stashes'" />
          </template>
        </draggable>
      </template>
    </UiSidebarContent>

    <!-- static footer: stays put while the content above scrolls -->
    <UiSidebarFooter>
      <UiSidebarMenu>
        <UiSidebarMenuItem v-for="item in links" :key="item.title">
          <UiSidebarMenuButton as-child :tooltip="item.title">
            <a
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              @click.prevent="openExternal(item.url)"
            >
              <NuxtIcon :name="item.icon" class="shrink-0" />
              <span>{{ item.title }}</span>
            </a>
          </UiSidebarMenuButton>
        </UiSidebarMenuItem>
        <UiSidebarMenuItem>
          <UiSidebarMenuButton :tooltip="t('help.title')" @click="help.show()">
            <NuxtIcon name="lucide:keyboard" class="shrink-0" />
            <span>{{ t('help.title') }}</span>
          </UiSidebarMenuButton>
        </UiSidebarMenuItem>
        <UiSidebarMenuItem>
          <UiSidebarMenuButton
            :tooltip="t('settings.title')"
            @click="settings.show()"
          >
            <NuxtIcon name="lucide:settings" class="shrink-0" />
            <span>{{ t('settings.title') }}</span>
          </UiSidebarMenuButton>
        </UiSidebarMenuItem>
      </UiSidebarMenu>
    </UiSidebarFooter>

    <UiSidebarRail />

    <!-- Drag handle on the right edge to resize the expanded sidebar. -->
    <div
      v-if="canResize"
      class="absolute inset-y-0 right-0 z-30 w-1 cursor-col-resize transition-colors hover:bg-sidebar-border"
      @pointerdown="startResize"
    />
  </UiSidebar>
</template>
