// "Show more / show less" state for capped sidebar lists, mirroring gildstone's
// useAppSidebarNavSectionState: show `initial` items, reveal `step` more per
// click (or all when step is null), and collapse back to `initial` once fully
// expanded.
export function useSidebarMore<T>({
  items,
  initial = 5,
  step = 10
}: {
  items: () => T[];
  initial?: number;
  step?: number | null;
}) {
  const count = ref<number | null>(null);
  const total = computed(() => items().length);
  const initialVisible = computed(() =>
    Math.min(total.value, Math.max(1, initial))
  );
  const resolved = computed(() => count.value ?? initialVisible.value);

  const visible = computed(() => items().slice(0, resolved.value));
  const hiddenCount = computed(() => total.value - resolved.value);
  const hasHidden = computed(() => hiddenCount.value > 0);
  const canCollapse = computed(() => resolved.value > initialVisible.value);
  const isExpanded = computed(() => !hasHidden.value && canCollapse.value);

  function toggle() {
    if (hasHidden.value) {
      count.value =
        step === null
          ? total.value
          : Math.min(total.value, resolved.value + step);
    } else if (canCollapse.value) {
      count.value = initialVisible.value;
    }
  }

  return { visible, hiddenCount, hasHidden, isExpanded, canCollapse, toggle };
}
