<script setup lang="ts">
import type { ListboxFilterProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { ListboxFilter, useForwardProps } from 'reka-ui';
import { watch } from 'vue';
import { cn } from '@/lib/utils';
import { useCommand } from '.';

defineOptions({
  inheritAttrs: false
});

const props = defineProps<
  ListboxFilterProps & {
    class?: HTMLAttributes['class'];
  }
>();

const delegatedProps = reactiveOmit(props, 'class');

const forwardedProps = useForwardProps(delegatedProps);

const { filterState } = useCommand();

// Optional `v-model:search` handle so a parent can read or reset the live query
// (e.g. clearing it when switching to a nested page). Stays in sync with the
// command's internal filter both ways; guarded assignment avoids a feedback loop.
const search = defineModel<string>('search');
watch(
  () => filterState.search,
  (v) => {
    if (search.value !== v) search.value = v;
  }
);
watch(search, (v) => {
  if (v !== undefined && v !== filterState.search) filterState.search = v;
});
</script>

<template>
  <div
    data-slot="command-input-wrapper"
    class="flex h-9 items-center gap-2 border-b px-3"
  >
    <NuxtIcon name="lucide:search" class="size-4 shrink-0 opacity-50" />
    <ListboxFilter
      v-bind="{ ...forwardedProps, ...$attrs }"
      v-model="filterState.search"
      data-slot="command-input"
      auto-focus
      :class="
        cn(
          'placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
          props.class
        )
      "
    />
  </div>
</template>
