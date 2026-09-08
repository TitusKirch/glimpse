// One registry for simple boolean overlay state (the settings/help/open-repo/
// add-remote dialogs and the command palette). Each name maps to a single shared
// ref, so every caller of useOverlay(name) — opener, shortcut, and the dialog
// itself — drives the same overlay through one uniform interface.
//
// Promise-based intents (useConfirm, usePrompt) are a different, deeper shape
// (request → answer) and intentionally stay separate.
//
// The registry is deliberately process-lifetime, and nothing here is ever
// released: an overlay's state has to outlive whichever component is mounted at
// the time — the palette flips an overlay whose dialog has not been created yet,
// and closing a dialog unmounts it while its state has to survive to open again.
// That only stays sound while the set of names is finite, so the names are
// declared here rather than minted at the call site. Taking any `string` invited
// a name derived from data — a repo id, a file path, a commit hash — and one
// such call would turn a fixed registry into an unbounded one while reading like
// ordinary code at the call site. Declared names make it a type error, and the
// map is built once from the list below, so no call can add an entry to it.

import { ref, type Ref } from 'vue';

export const overlayNames = [
  'bisect',
  'clone',
  'commandPalette',
  'commitReview',
  'compare',
  'help',
  'init',
  'mergeEditor',
  'openRepo',
  'quickOpen',
  'rebasePlan',
  'reflog',
  'remote',
  'settings',
  'sparse',
  'stash',
  'stats',
  'submodules',
  'tagCreate',
  'worktrees'
] as const;

export type OverlayName = (typeof overlayNames)[number];

const overlays = new Map<OverlayName, Ref<boolean>>(
  overlayNames.map((name) => [name, ref(false)] as const)
);

export function useOverlay(name: OverlayName) {
  const state = overlays.get(name);
  // Reachable only from somewhere the union was not enforced. Throwing beats
  // minting the entry (the leak this list exists to prevent) and beats handing
  // back a detached ref, which would show up much later as a dialog that never
  // opens, with nothing pointing back here.
  if (!state) {
    throw new Error(`Unknown overlay "${name}" — add it to overlayNames.`);
  }
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
