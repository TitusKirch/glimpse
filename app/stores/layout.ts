// Persisted UI layout state (survives restarts via pinia-plugin-persistedstate).
// Repo data lives in the repo store and is intentionally NOT persisted.

import { acceptHMRUpdate } from 'pinia';
import type { DiffMode } from '@/stores/repo';

export type FileView = 'list' | 'tree';
export type Accent = 'default' | 'blue' | 'violet' | 'green' | 'amber' | 'rose';

export const useLayoutStore = defineStore('layout', {
  state: () => ({
    sidebarOpen: true,
    // Expanded sidebar width in px, drag-resizable within [256, 384] (16–24rem).
    sidebarWidth: 256,
    // Horizontal split between the commit graph (left) and the diff (right).
    panelSizes: [58, 42] as number[],
    // Vertical split inside a commit's diff view (detail / file list / diff).
    commitPanelSizes: [20, 25, 55] as number[],
    diffMode: 'split' as DiffMode,
    // Ignore whitespace-only changes in diffs (git -w).
    ignoreWhitespace: false,
    // Pull strategy: plain merge or --rebase.
    pullStrategy: 'merge' as 'merge' | 'rebase',
    leftTab: 'changes' as 'changes' | 'history',
    // Flat list vs. grouped folder tree for file lists.
    fileView: 'tree' as FileView,
    // Collapse the noisy middle of long bot branch refs (dependabot/…/pkg) in
    // the graph so their badges don't crowd the commit subjects.
    shortenDependabot: true,
    // Theme accent colour (overrides the neutral --primary token).
    accent: 'default' as Accent,
    // Diff font scale (1 = default); applied to the diff via --mono-scale.
    monoScale: 1,
    // Periodically fetch in the background and flag new upstream commits.
    autoFetch: false,
    autoFetchMinutes: 5,
    // Check for app updates on launch (and auto-install when found).
    autoUpdate: true,
    // Update channel: stable releases or opt-in beta builds.
    releaseChannel: 'stable' as 'stable' | 'beta',
    // Developer settings (extra debug tools in the settings dialog).
    devMode: false
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
    setCommitPanelSizes(sizes: number[]) {
      this.commitPanelSizes = sizes;
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

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLayoutStore, import.meta.hot));
}
