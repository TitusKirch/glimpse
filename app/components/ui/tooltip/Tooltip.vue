<script setup lang="ts">
import type { TooltipRootEmits, TooltipRootProps } from 'reka-ui';
import { TooltipRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<TooltipRootProps>();
const emits = defineEmits<TooltipRootEmits>();

// Suppress every tooltip while a drag-to-reorder is in progress: the
// pointer-driven fallback drag sweeps over tabs/sidebar items and would
// otherwise pop their tooltips mid-drag. Centralised here so all tooltips
// (including the sidebar menu-button tooltips, which use this component) are
// covered in one place. A caller's own `disabled` still wins when it's set.
const { isReordering } = useDragReorder();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <TooltipRoot
    v-slot="slotProps"
    data-slot="tooltip"
    v-bind="forwarded"
    :disabled="props.disabled || isReordering"
  >
    <slot v-bind="slotProps" />
  </TooltipRoot>
</template>
