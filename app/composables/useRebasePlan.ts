// Shared state for the interactive-rebase plan dialog. `useOverlay` only carries
// a boolean, so the hash of the commit the rebase starts from is held here in a
// module-level ref and exposed alongside the overlay controls.

const start = ref<string | null>(null);

export function useRebasePlan() {
  const overlay = useOverlay('rebasePlan');
  return {
    open: overlay.open,
    start,
    // Open the dialog to rebase from `hash` (that commit and its descendants).
    show: (hash: string) => {
      start.value = hash;
      overlay.show();
    },
    hide: overlay.hide
  };
}
