<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import type { AlertVariants } from '.';
import { cn } from '@/lib/utils';
import { alertVariants } from '.';

const props = defineProps<{
  class?: HTMLAttributes['class'];
  variant?: AlertVariants['variant'];
}>();

// The leading icon is derived purely from the variant — callers pass nothing.
// Explicit size class (not a `[&>svg]` selector) so it renders regardless of
// how NuxtIcon emits the glyph (svg vs css mask).
const variantIcons: Record<string, string> = {
  default: 'lucide:info',
  info: 'lucide:info',
  destructive: 'lucide:circle-alert'
};
const icon = computed(() => variantIcons[props.variant ?? 'default']);
</script>

<template>
  <div
    data-slot="alert"
    :class="cn(alertVariants({ variant }), props.class)"
    role="alert"
  >
    <NuxtIcon :name="icon" class="size-4 shrink-0 translate-y-0.5" />
    <div class="min-w-0 flex-1 space-y-0.5"><slot /></div>
  </div>
</template>
