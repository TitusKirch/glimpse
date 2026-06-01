<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import type { BadgeVariants } from '.';
import { reactiveOmit } from '@vueuse/core';
import { Primitive } from 'reka-ui';
import { cn } from '@/lib/utils';
import { badgeVariants } from '.';

const props = withDefaults(
  defineProps<
    PrimitiveProps & {
      variant?: BadgeVariants['variant'];
      size?: BadgeVariants['size'];
      class?: HTMLAttributes['class'];
      // Leading icon (lucide name), rendered before the label — mirrors UiButton.
      icon?: string;
      iconSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    }
  >(),
  { iconSize: 'sm' }
);

const ICON_SIZE = {
  xs: 'size-2.5',
  sm: 'size-3',
  md: 'size-3.5',
  lg: 'size-4',
  xl: 'size-5'
} as const;
const iconClass = computed(() => ICON_SIZE[props.iconSize]);

const delegatedProps = reactiveOmit(props, 'class', 'icon', 'iconSize');
</script>

<template>
  <Primitive
    data-slot="badge"
    :class="cn(badgeVariants({ variant, size }), props.class)"
    v-bind="delegatedProps"
  >
    <NuxtIcon v-if="icon" :name="icon" :class="iconClass" />
    <slot />
  </Primitive>
</template>
