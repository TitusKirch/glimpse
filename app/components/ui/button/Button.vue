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
  // When true the button is disabled and shows a spinner in place of its
  // content — for in-flight actions.
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button'
});
</script>

<template>
  <Primitive
    data-slot="button"
    :data-variant="variant"
    :data-size="size"
    :as="as"
    :as-child="asChild"
    :disabled="disabled || loading"
    :data-loading="loading || undefined"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <NuxtIcon v-if="loading" name="lucide:loader-circle" class="animate-spin" />
    <slot v-else />
  </Primitive>
</template>
