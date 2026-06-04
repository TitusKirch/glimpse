<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import type { AlertVariants } from '.';
import { cn } from '@/lib/utils';
import { alertVariants } from '.';

const props = defineProps<{
  class?: HTMLAttributes['class'];
  variant?: AlertVariants['variant'];
  // Leading icon. Defaults to a sensible per-variant icon; pass a custom name to
  // override, or `false` to render none (e.g. for a bespoke inner layout).
  icon?: string | false;
}>();

// Each variant carries a recognisable default so callers get a consistent icon
// for free; the grid in `alertVariants` reserves the leading column for it.
const defaultIcons: Record<string, string> = {
  default: 'lucide:info',
  info: 'lucide:info',
  destructive: 'lucide:circle-alert'
};

const resolvedIcon = computed(() => {
  if (props.icon === false) return null;
  if (props.icon) return props.icon;
  return defaultIcons[props.variant ?? 'default'];
});
</script>

<template>
  <div
    data-slot="alert"
    :class="cn(alertVariants({ variant }), props.class)"
    role="alert"
  >
    <NuxtIcon v-if="resolvedIcon" :name="resolvedIcon" mode="svg" />
    <slot />
  </div>
</template>
