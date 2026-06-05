// Shared state for the three-way merge editor: the conflicted file to resolve
// plus the overlay (useOverlay is boolean-only, so the path lives here).

const file = ref<string | null>(null);

export function useMergeEditor() {
  const overlay = useOverlay('mergeEditor');
  return {
    open: overlay.open,
    file,
    show: (f: string) => {
      file.value = f;
      overlay.show();
    },
    hide: overlay.hide
  };
}
