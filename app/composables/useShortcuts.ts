// Global keyboard shortcuts, wired once from app.vue. Uses vueuse's
// useEventListener (auto-cleanup) rather than a hand-rolled listener. Combos
// that would otherwise hit a webview default (mod+K) are prevented. Most
// shortcuts are ignored while typing in a field; the palette and commit are
// not, so they stay reachable from the commit box.

import { useEventListener } from '@vueuse/core';

export function useShortcuts() {
  const repo = useRepoStore();
  const layout = useLayoutStore();
  const palette = useCommandPalette();
  const settings = useSettingsDialog();

  const isMac = navigator.platform.toLowerCase().includes('mac');

  function typing(): boolean {
    const el = document.activeElement as HTMLElement | null;
    return (
      !!el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable)
    );
  }

  useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();

    // Always available, even while typing.
    if (k === 'k') {
      e.preventDefault();
      palette.toggle();
      return;
    }
    if (k === ',') {
      e.preventDefault();
      settings.show();
      return;
    }
    if (k === 'b') {
      e.preventDefault();
      layout.setSidebarOpen(!layout.sidebarOpen);
      return;
    }
    if (k === 'enter') {
      e.preventDefault();
      void repo.commit();
      return;
    }

    if (typing() || !repo.hasRepos) return;
    if (e.shiftKey && k === 'f') {
      e.preventDefault();
      void repo.sync('fetch');
    } else if (e.shiftKey && k === 'l') {
      e.preventDefault();
      void repo.sync('pull');
    } else if (e.shiftKey && k === 'u') {
      e.preventDefault();
      void repo.sync('push');
    }
  });
}
