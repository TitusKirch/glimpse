// Shared state for the tag-create dialog: the target commit (empty string =
// HEAD) plus the overlay. useOverlay carries only a boolean, so the target hash
// lives in a module-level ref.

const hash = ref<string | null>(null);

export function useTagCreate() {
  const overlay = useOverlay('tagCreate');
  return {
    open: overlay.open,
    hash,
    // Open the dialog to tag `target` (or HEAD when empty).
    show: (target: string) => {
      hash.value = target;
      overlay.show();
    },
    hide: overlay.hide
  };
}
