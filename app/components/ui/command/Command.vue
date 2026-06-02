<script setup lang="ts">
import type { ListboxRootEmits, ListboxRootProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { reactiveOmit } from '@vueuse/core';
import { ListboxRoot, useForwardPropsEmits } from 'reka-ui';
import { reactive, ref, watch } from 'vue';
import { useSearch } from '@/composables/useSearch';
import { cn } from '@/lib/utils';
import { provideCommandContext } from '.';

const props = withDefaults(
  defineProps<ListboxRootProps & { class?: HTMLAttributes['class'] }>(),
  {
    modelValue: ''
  }
);

const emits = defineEmits<ListboxRootEmits>();

const delegatedProps = reactiveOmit(props, 'class');

const forwarded = useForwardPropsEmits(delegatedProps, emits);

const allItems = ref<Map<string, string>>(new Map());
const allGroups = ref<Map<string, Set<string>>>(new Map());

const { fuzzySearch } = useSearch();

const filterState = reactive({
  search: '',
  filtered: {
    /** The count of all visible items. */
    count: 0,
    /** Map from visible item id to its search score. */
    items: new Map() as Map<string, number>,
    /** Set of groups with at least one visible item. */
    groups: new Set() as Set<string>
  }
});

// Fuzzy matching via the shared useSearch helper (replaces reka-ui's substring
// `useFilter`), so a query like "fpush" still finds "Force push". The set is
// tiny (a few dozen palette items), so rebuilding the index per keystroke is
// cheap. We keep the same filterState contract the command items/groups read: a
// per-id score (>0 = visible) plus the set of groups with a visible item.
function filterItems() {
  if (!filterState.search) {
    filterState.filtered.count = allItems.value.size;
    // Do nothing, each item will know to show itself because search is empty
    return;
  }

  const items = new Map<string, number>();
  // Default everything in the map to hidden; matches get a positive score below.
  // Items that have already unmounted (and left allItems) stay absent, so they
  // fall back to a first render — this is how broadening a query reveals them.
  for (const [id] of allItems.value) items.set(id, 0);

  const entries = Array.from(allItems.value, ([id, value]) => ({ id, value }));
  const hits = fuzzySearch(entries, filterState.search, { keys: ['value'] });
  for (const { item, score } of hits) items.set(item.id, score);

  const groups = new Set<string>();
  for (const [groupId, group] of allGroups.value) {
    for (const itemId of group) {
      if ((items.get(itemId) ?? 0) > 0) {
        groups.add(groupId);
        break;
      }
    }
  }

  filterState.filtered.items = items;
  filterState.filtered.groups = groups;
  filterState.filtered.count = hits.length;
}

watch(
  () => filterState.search,
  () => {
    filterItems();
  }
);

provideCommandContext({
  allItems,
  allGroups,
  filterState
});
</script>

<template>
  <ListboxRoot
    data-slot="command"
    v-bind="forwarded"
    :class="
      cn(
        'bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md',
        props.class
      )
    "
  >
    <slot />
  </ListboxRoot>
</template>
