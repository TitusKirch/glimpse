// Tooltip for an icon button that opens a dialog/overlay (the open-repo "+" and
// the sidebar create actions). Reka opens a tooltip on hover AND on focus, so
// when the dialog closes and returns focus to the trigger, a focus-driven
// tooltip reappears and sits there over subsequent work.
//
// The fix: let only the POINTER open the tooltip, never focus. Every such button
// already carries an aria-label, so the tooltip is purely a mouse affordance and
// keyboard/screen-reader users lose nothing. Bind `open`/`onOpenChange` on the
// tooltip, spread `hover` on the trigger, and wrap the click in `onActivate`.
export function useDismissableTooltip() {
  const open = ref(false);
  const hovering = ref(false);

  // Apply close requests always; allow open requests only while the pointer is
  // actually over the trigger (i.e. ignore focus-driven opens).
  const onOpenChange = (value: boolean) => {
    if (value && !hovering.value) return;
    open.value = value;
  };
  const onPointerenter = () => {
    hovering.value = true;
  };
  const onPointerleave = () => {
    hovering.value = false;
  };
  // Close the tooltip and drop hover intent the moment the button fires, then
  // run its action — so it can't linger over the dialog that opens.
  const onActivate = (action: () => void) => {
    open.value = false;
    hovering.value = false;
    action();
  };

  return {
    open,
    onOpenChange,
    hover: { onPointerenter, onPointerleave },
    onActivate
  };
}
