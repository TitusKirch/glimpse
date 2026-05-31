// reka-ui only locks body scroll while a dialog is open, but our scrollable
// regions are inner overflow-auto panels — so the background still scrolls.
// Block wheel/touch scrolling outside the open dialog. Wired once in app.vue.
import { useEventListener } from '@vueuse/core';

export function useModalScrollLock() {
  function dialogOpen(): boolean {
    return !!document.querySelector('[role="dialog"][data-state="open"]');
  }

  const block = (e: Event) => {
    if (!dialogOpen()) return;
    const target = e.target as HTMLElement | null;
    // Allow scrolling inside the dialog itself.
    if (target?.closest('[role="dialog"]')) return;
    e.preventDefault();
  };

  useEventListener(window, 'wheel', block, { passive: false });
  useEventListener(window, 'touchmove', block, { passive: false });
}
