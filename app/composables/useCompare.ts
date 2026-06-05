// Shared state for the compare dialog. useOverlay carries only a boolean, so
// optional preset refs (used when comparing two commits selected in the graph)
// live here in module-level refs; the dialog consumes and clears them on open.

const presetFrom = ref<string | null>(null);
const presetTo = ref<string | null>(null);

export function useCompare() {
  const overlay = useOverlay('compare');
  return {
    open: overlay.open,
    presetFrom,
    presetTo,
    // Open the compare dialog pre-filled with two refs/commits.
    compareRefs: (a: string, b: string) => {
      presetFrom.value = a;
      presetTo.value = b;
      overlay.show();
    },
    hide: overlay.hide
  };
}
