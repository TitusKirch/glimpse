<script setup lang="ts">
// A "show N more / show less" toggle row for capped sidebar lists.
defineProps<{ total: number; limit: number }>();
const expanded = defineModel<boolean>('expanded', { required: true });
const { t } = useI18n();
</script>

<template>
  <button
    v-if="total > limit"
    class="w-full cursor-pointer px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground group-data-[collapsible=icon]:hidden"
    @click="expanded = !expanded"
  >
    {{
      expanded
        ? t('sidebar.showLess')
        : t('sidebar.showMore', { n: total - limit })
    }}
  </button>
</template>
