// Global keyboard shortcuts, wired once from app.vue. Uses vueuse's
// useEventListener (auto-cleanup) rather than a hand-rolled listener. Combos
// that would otherwise hit a webview default (mod+K) are prevented. Most
// shortcuts are ignored while typing in a field; the palette and commit are
// not, so they stay reachable from the commit box.

import { useEventListener } from '@vueuse/core';

export function useShortcuts() {
  const repo = useRepoStore();
  const settingsStore = useSettingsStore();
  const changelists = useChangelistsStore();
  const palette = useOverlay('commandPalette');
  const quickOpen = useOverlay('quickOpen');
  const settings = useOverlay('settings');
  const help = useOverlay('help');

  // Cmd/Ctrl+↵ commits: the active changelist when changelists are on, else the
  // staged set.
  function commitFromShortcut() {
    if (!settingsStore.changelists) return repo.commit();
    const cl = changelists.forRepo(repo.repoPath);
    const active = cl.lists.find((l) => l.id === cl.activeId) ?? cl.lists[0];
    return repo.commitList(active?.members ?? []);
  }

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
    if (k === 'p') {
      e.preventDefault();
      if (repo.hasRepos) quickOpen.toggle();
      return;
    }
    if (k === ',') {
      e.preventDefault();
      settings.show();
      return;
    }
    // Ctrl/Cmd+B (toggle sidebar) is handled by the sidebar provider itself,
    // which also syncs our persisted state — handling it here too would double-
    // toggle and cancel out.
    if (k === '/') {
      e.preventDefault();
      help.toggle();
      return;
    }
    if (k === 'enter') {
      e.preventDefault();
      void commitFromShortcut();
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
