import { readonly, ref } from 'vue';

// Shared transient flag: true while a drag-to-reorder (repo tabs or sidebar
// sections) is in progress. The reorder is a pointer-driven fallback drag, so as
// the pointer sweeps over items it would otherwise pop their tooltips mid-drag,
// which looks buggy. The shared UiTooltip reads this flag and stays disabled
// while it's set, suppressing every tooltip at once. Module-level so all callers
// share one instance — the app is a client-only SPA, so module state is a safe
// singleton. Wire a draggable's sortable start/end events to startReorder /
// endReorder.
const reordering = ref(false);

export function useDragReorder() {
  return {
    isReordering: readonly(reordering),
    startReorder: () => {
      reordering.value = true;
    },
    endReorder: () => {
      reordering.value = false;
    }
  };
}
