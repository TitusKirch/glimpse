// Persisted UI layout state (survives restarts via pinia-plugin-persistedstate).
// Repo data lives in the repo store and is intentionally NOT persisted.

import type { DiffMode } from '@/stores/repo';

export type FileView = 'list' | 'tree';

export const useLayoutStore = defineStore('layout', {
  state: () => ({
    sidebarOpen: true,
    // Horizontal split between the commit graph (left) and the diff (right).
    panelSizes: [58, 42] as number[],
    diffMode: 'split' as DiffMode,
    leftTab: 'changes' as 'changes' | 'history',
    // Flat list vs. grouped folder tree for file lists.
    fileView: 'tree' as FileView
  }),
  actions: {
    setSidebarOpen(open: boolean) {
      this.sidebarOpen = open;
    },
    setLeftTab(tab: 'changes' | 'history') {
      this.leftTab = tab;
    },
    setPanelSizes(sizes: number[]) {
      this.panelSizes = sizes;
    },
    setDiffMode(mode: DiffMode) {
      this.diffMode = mode;
    },
    setFileView(view: FileView) {
      this.fileView = view;
    },
    toggleFileView() {
      this.fileView = this.fileView === 'list' ? 'tree' : 'list';
    }
  },
  persist: true
});
