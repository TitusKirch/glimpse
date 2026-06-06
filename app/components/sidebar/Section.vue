<script setup lang="ts">
import { useSidebar } from '@/components/ui/sidebar';

// One collapsible sidebar section: a clickable label (chevron toggles collapse),
// an optional drag handle shown only in edit mode, the section's action button
// (slot) and its content (slot). Collapse + edit state are read from the layout
// store by section id so the parent only has to name the section.
const props = defineProps<{
  sectionId: string;
  label: string;
  // Item count + loading flag drive the section's placeholder states: a skeleton
  // while loading-with-nothing-yet, and the `emptyLabel` "none yet" line once
  // loaded with no items. Whether an empty section is shown at all is decided
  // upstream in Sidebar.vue (the hide-empty-sections setting). Sections that omit
  // `count` always render their slot.
  count?: number;
  loading?: boolean;
  emptyLabel?: string;
}>();

const { t } = useI18n();
const layout = useLayoutStore();

// In the icon-only sidebar the header is hidden and editing/collapse don't
// apply, so the handle and chevron hide and content always shows as icons.
const { state, isMobile } = useSidebar();
const isIcon = computed(() => state.value === 'collapsed' && !isMobile.value);

const collapsed = computed(() =>
  layout.sidebarCollapsedSections.includes(props.sectionId)
);
const editMode = computed(() => layout.sidebarEditMode && !isIcon.value);

// Loading with nothing to show yet → skeleton (not on refresh, where items are
// already present). Loaded with nothing → a "none yet" line. Whether an empty
// section is shown at all is decided upstream (visibleSections), so here we just
// render the placeholder when we are shown empty.
const showSkeleton = computed(
  () => props.count === 0 && props.loading === true
);
const showEmptyLabel = computed(
  () => props.count === 0 && props.loading !== true && !!props.emptyLabel
);
</script>

<template>
  <UiSidebarGroup>
    <!-- Header: drag handle (edit mode) + chevron/label toggle. Hidden when the
         sidebar is in icon-only mode, where labels collapse away. -->
    <div class="flex items-center group-data-[collapsible=icon]:hidden">
      <div
        v-if="editMode"
        class="sidebar-section-handle flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground active:cursor-grabbing"
        :aria-label="t('sidebar.reorderHint')"
        :title="t('sidebar.reorderHint')"
      >
        <NuxtIcon name="lucide:grip-vertical" class="size-3.5" />
      </div>
      <UiSidebarGroupLabel
        as="button"
        type="button"
        :class="['flex-1 cursor-pointer gap-1', editMode && 'pl-0.5']"
        :aria-expanded="!collapsed"
        :aria-label="
          collapsed ? t('sidebar.expandSection') : t('sidebar.collapseSection')
        "
        @click="layout.toggleSidebarSection(sectionId)"
      >
        <NuxtIcon
          name="lucide:chevron-right"
          class="size-3.5 shrink-0 text-muted-foreground transition-transform"
          :class="collapsed ? '' : 'rotate-90'"
        />
        <span class="flex-1 truncate text-left">{{ label }}</span>
      </UiSidebarGroupLabel>
    </div>

    <slot name="action" />

    <UiSidebarGroupContent v-show="!collapsed || isIcon">
      <SidebarSectionSkeleton v-if="showSkeleton" />
      <p
        v-else-if="showEmptyLabel"
        class="px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
      >
        {{ emptyLabel }}
      </p>
      <slot v-else />
    </UiSidebarGroupContent>
  </UiSidebarGroup>
</template>
