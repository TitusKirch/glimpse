<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import type { ButtonVariants } from '.';
import { Primitive } from 'reka-ui';
import { cn } from '@/lib/utils';
import { buttonVariants } from '.';

interface Props extends PrimitiveProps {
  variant?: ButtonVariants['variant'];
  size?: ButtonVariants['size'];
  class?: HTMLAttributes['class'];
  disabled?: boolean;
  // Leading icon (lucide name). While `pending` it is swapped for a spinner —
  // the label (default slot) is left untouched.
  icon?: string;
  iconSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  // When true the button is disabled and its leading icon becomes a spinner.
  pending?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
  iconSize: 'md'
});

const ICON_SIZE = {
  xs: 'size-3',
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
  xl: 'size-6'
} as const;
const iconClass = computed(() => ICON_SIZE[props.iconSize]);

defineSlots<{
  default?: () => unknown;
  leading?: (props: { pending?: boolean; icon?: string }) => unknown;
}>();
</script>

<template>
  <Primitive
    data-slot="button"
    :data-variant="variant"
    :data-size="size"
    :as="as"
    :as-child="asChild"
    :disabled="disabled || pending"
    :data-loading="pending || undefined"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <slot name="leading" :pending="pending" :icon="icon">
      <NuxtIcon
        v-if="pending"
        name="lucide:loader-circle"
        :class="[iconClass, 'animate-spin']"
      />
      <NuxtIcon v-else-if="icon" :name="icon" :class="iconClass" />
    </slot>
    <slot />
  </Primitive>
</template>
