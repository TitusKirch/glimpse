// Shared open state for the settings dialog so it can be opened from the
// sidebar, the command palette, or a keyboard shortcut.

const open = ref(false);

export function useSettingsDialog() {
  return {
    open,
    show: () => {
      open.value = true;
    }
  };
}
