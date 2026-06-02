// One registry for simple boolean overlay state (the settings/help/open-repo/
// add-remote dialogs and the command palette). Each name maps to a single shared
// ref, so every caller of useOverlay(name) — opener, shortcut, and the dialog
// itself — drives the same overlay through one uniform interface.
//
// Promise-based intents (useConfirm, usePrompt) are a different, deeper shape
// (request → answer) and intentionally stay separate.

const overlays = new Map<string, Ref<boolean>>();

export function useOverlay(name: string) {
  let open = overlays.get(name);
  if (!open) {
    open = ref(false);
    overlays.set(name, open);
  }
  const state = open;
  return {
    open: state,
    show: () => {
      state.value = true;
    },
    hide: () => {
      state.value = false;
    },
    toggle: () => {
      state.value = !state.value;
    }
  };
}
