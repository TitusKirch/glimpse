// Ephemeral UI view state (survives restarts via pinia-plugin-persistedstate):
// panel splits, sidebar open/edit/order, the active left tab, the diff
// whitespace toggle. The user's real settings live in the `settings` store; repo
// data lives in the repo store and is intentionally NOT persisted.

import { acceptHMRUpdate } from 'pinia';

export type FileView = 'list' | 'tree';
// How `git pull` reconciles diverged branches: merge (--no-rebase), rebase
// (--rebase), or fast-forward only (--ff-only). Passed straight to the backend.
export type PullStrategy = 'merge' | 'rebase' | 'ff-only';
export type Accent = 'default' | 'blue' | 'violet' | 'green' | 'amber' | 'rose';

// The sidebar sections in their default top-to-bottom order. The user can
// reorder and collapse them individually (persisted below); this list is also
// the source of truth for normalising a stale persisted order — unknown ids are
// dropped and newly-added sections are appended.
export const SIDEBAR_SECTIONS = [
  'branches',
  'remotes',
  'remoteBranches',
  'tags',
  'stashes'
] as const;
export type SidebarSectionId = (typeof SIDEBAR_SECTIONS)[number];

export const useLayoutStore = defineStore('layout', {
  state: () => ({
    sidebarOpen: true,
    // User-defined top-to-bottom order of the sidebar sections (a permutation of
    // SIDEBAR_SECTIONS; normalised on hydrate so a stale list can't break it).
    sidebarSectionOrder: [...SIDEBAR_SECTIONS] as string[],
    // Ids of the sidebar sections the user has collapsed (header still shown).
    sidebarCollapsedSections: [] as string[],
    // Edit mode: when on, sidebar sections show a drag handle and can be
    // reordered. Toggled from the settings dialog (and the in-sidebar "done").
    sidebarEditMode: false,
    // Horizontal split between the commit graph (left) and the diff (right).
    panelSizes: [58, 42] as number[],
    // Vertical split inside a commit's diff view (detail / file list / diff).
    commitPanelSizes: [20, 25, 55] as number[],
    // Ignore whitespace-only changes in diffs (git -w).
    ignoreWhitespace: false,
    leftTab: 'changes' as 'changes' | 'history'
  }),
  actions: {
    setSidebarOpen(open: boolean) {
      this.sidebarOpen = open;
    },
    // Persist a new section order (the caller supplies a full permutation).
    reorderSidebarSections(order: string[]) {
      this.sidebarSectionOrder = order;
    },
    // Collapse/expand one section by id.
    toggleSidebarSection(id: string) {
      this.sidebarCollapsedSections = this.sidebarCollapsedSections.includes(id)
        ? this.sidebarCollapsedSections.filter((s) => s !== id)
        : [...this.sidebarCollapsedSections, id];
    },
    setSidebarEditMode(on: boolean) {
      this.sidebarEditMode = on;
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
    // Reconcile the persisted sidebar section order/collapse with the current
    // set of known sections: keep the user's order, drop ids that no longer
    // exist (and any duplicates), append sections added in a newer build, and
    // forget collapse flags for unknown ids. Keeps a stale localStorage value
    // from hiding or breaking a section.
    normalizeSections() {
      const known = SIDEBAR_SECTIONS as readonly string[];
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const id of this.sidebarSectionOrder) {
        if (known.includes(id) && !seen.has(id)) {
          seen.add(id);
          ordered.push(id);
        }
      }
      for (const id of known) if (!seen.has(id)) ordered.push(id);
      this.sidebarSectionOrder = ordered;
      this.sidebarCollapsedSections = this.sidebarCollapsedSections.filter(
        (id) => known.includes(id)
      );
    }
  },
  persist: {
    // Validate the persisted sidebar section order/collapse on load so a stale
    // value left in localStorage (older build, hand-edited) is corrected at once.
    afterHydrate: (ctx) => {
      ctx.store.normalizeSections();
    }
  }
});

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLayoutStore, import.meta.hot));
}
