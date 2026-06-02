<script setup lang="ts">
// One tag row. Collapsed (icon-only) sidebar: the whole button opens a dropdown
// with the actions; expanded: the hover "…" opens the same actions. Mirrors
// SidebarBranchItem so tags stay actionable when the sidebar is collapsed.
defineProps<{ tag: string; collapsed: boolean }>();
</script>

<template>
  <!-- collapsed: the button is the dropdown trigger -->
  <UiSidebarMenuItem v-if="collapsed">
    <UiDropdownMenu>
      <UiDropdownMenuTrigger as-child>
        <UiSidebarMenuButton :tooltip="tag">
          <NuxtIcon name="lucide:tag" class="shrink-0" />
          <span>{{ tag }}</span>
        </UiSidebarMenuButton>
      </UiDropdownMenuTrigger>
      <UiDropdownMenuContent side="right" align="start">
        <SidebarTagActions :tag="tag" />
      </UiDropdownMenuContent>
    </UiDropdownMenu>
  </UiSidebarMenuItem>

  <!-- expanded: "…" opens the actions -->
  <UiSidebarMenuItem v-else>
    <UiSidebarMenuButton :tooltip="tag">
      <NuxtIcon name="lucide:tag" class="shrink-0" />
      <span>{{ tag }}</span>
    </UiSidebarMenuButton>
    <UiDropdownMenu>
      <UiDropdownMenuTrigger as-child>
        <UiSidebarMenuAction show-on-hover class="cursor-pointer">
          <NuxtIcon name="lucide:ellipsis" />
        </UiSidebarMenuAction>
      </UiDropdownMenuTrigger>
      <UiDropdownMenuContent side="right" align="start">
        <SidebarTagActions :tag="tag" />
      </UiDropdownMenuContent>
    </UiDropdownMenu>
  </UiSidebarMenuItem>
</template>
