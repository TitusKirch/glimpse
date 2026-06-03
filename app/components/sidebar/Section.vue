<script setup lang="ts">
import { useSidebar } from '@/components/ui/sidebar';

// One collapsible sidebar section: a clickable label (chevron toggles collapse),
// an optional drag handle shown only in edit mode, the section's action button
// (slot) and its content (slot). Collapse + edit state are read from the layout
// store by section id so the parent only has to name the section.
const props = defineProps<{
  sectionId: string;
  label: string;
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
      <slot />
    </UiSidebarGroupContent>
  </UiSidebarGroup>
</template>
