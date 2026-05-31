// Shared open state for the single command palette, so the keyboard handler,
// the toolbar button and the palette itself all drive one instance.

const open = ref(false);

export function useCommandPalette() {
  return {
    open,
    toggle: () => {
      open.value = !open.value;
    },
    show: () => {
      open.value = true;
    },
    hide: () => {
      open.value = false;
    }
  };
}
