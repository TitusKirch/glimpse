<script setup lang="ts">
// "Show N more / show less" row rendered as a sidebar menu item (gildstone
// style): the more-icon with a count, or chevron-up to collapse.
const props = defineProps<{
  hiddenCount: number;
  expanded: boolean;
  canCollapse: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();
const { t } = useI18n();

const label = computed(() =>
  props.hiddenCount > 0
    ? t('sidebar.showMore', { n: props.hiddenCount })
    : t('sidebar.showLess')
);
const icon = computed(() =>
  props.expanded ? 'lucide:chevron-up' : 'lucide:more-horizontal'
);
const show = computed(() => props.hiddenCount > 0 || props.canCollapse);
</script>

<template>
  <UiSidebarMenuItem v-if="show">
    <UiSidebarMenuButton
      class="text-muted-foreground"
      :tooltip="label"
      @click="emit('toggle')"
    >
      <NuxtIcon :name="icon" class="shrink-0" />
      <span>{{ label }}</span>
    </UiSidebarMenuButton>
  </UiSidebarMenuItem>
</template>
