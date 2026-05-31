<script lang="ts" setup>
import type { ToasterProps } from 'vue-sonner';
import { Toaster as Sonner } from 'vue-sonner';
import 'vue-sonner/style.css';
import { cn } from '@/lib/utils';

const props = defineProps<ToasterProps>();
</script>

<template>
  <Sonner
    :class="cn('toaster group', props.class)"
    :style="{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--border-radius': 'var(--radius)'
    }"
    v-bind="props"
  >
    <template #success-icon>
      <NuxtIcon name="lucide:circle-check" class="size-4" />
    </template>
    <template #info-icon>
      <NuxtIcon name="lucide:info" class="size-4" />
    </template>
    <template #warning-icon>
      <NuxtIcon name="lucide:triangle-alert" class="size-4" />
    </template>
    <template #error-icon>
      <NuxtIcon name="lucide:octagon-x" class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <NuxtIcon name="lucide:loader-circle" class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <NuxtIcon name="lucide:x" class="size-4" />
    </template>
  </Sonner>
</template>
