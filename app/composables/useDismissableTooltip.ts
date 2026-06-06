// A tooltip whose trigger opens a dialog/overlay (the open-repo "+" and the
// sidebar create actions) stays stuck: after the click the trigger keeps focus,
// so Reka's focus/hover-driven tooltip re-opens and lingers over the dialog.
// Take control of the tooltip's open state (`v-model:open`) and force it shut as
// the action fires. Bind `open` and wrap the trigger's `@click` in `onActivate`.
export function useDismissableTooltip() {
  const open = ref(false);
  const onActivate = (action: () => void) => {
    open.value = false;
    action();
  };
  return { open, onActivate };
}
