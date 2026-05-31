// Shared open state for the keyboard-shortcuts help dialog.
const open = ref(false);

export function useHelpDialog() {
  return {
    open,
    show: () => {
      open.value = true;
    },
    toggle: () => {
      open.value = !open.value;
    }
  };
}
