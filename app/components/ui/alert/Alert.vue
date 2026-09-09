<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import type { AlertVariants } from '.';
import { cn } from '@/lib/utils';
import { alertIconVariants, alertVariants } from '.';

const props = defineProps<{
  class?: HTMLAttributes['class'];
  variant?: AlertVariants['variant'];
}>();

// The leading icon is derived purely from the variant — callers pass nothing.
// Keyed by the variant union rather than by `string`, so the lookup below is
// total and does not come back `string | undefined` under
// `noUncheckedIndexedAccess`.
const variantIcons: Record<NonNullable<AlertVariants['variant']>, string> = {
  default: 'lucide:info',
  info: 'lucide:info',
  success: 'lucide:circle-check',
  warning: 'lucide:triangle-alert',
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
    <NuxtIcon :name="icon" :class="alertIconVariants({ variant })" />
    <div class="min-w-0 flex-1 space-y-0.5"><slot /></div>
  </div>
</template>
