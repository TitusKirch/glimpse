<script setup lang="ts">
// Loading placeholder for a sidebar section's list: a few pulsing rows shown
// while the repo's git data loads, so each section (branches, remote branches,
// remotes, tags, stashes) shows a skeleton instead of an empty gap or a flash
// of nothing. Hidden in the icon-only sidebar, where sections render as icons.
withDefaults(defineProps<{ rows?: number }>(), { rows: 3 });

// Slightly varied widths read as a list rather than identical bars.
const WIDTHS = ['w-4/5', 'w-3/5', 'w-2/3', 'w-3/4', 'w-1/2'];
</script>

<template>
  <div class="space-y-1.5 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
    <UiSkeleton
      v-for="i in rows"
      :key="i"
      class="h-4"
      :class="WIDTHS[(i - 1) % WIDTHS.length]"
    />
  </div>
</template>
