// Persisted UI layout state (survives restarts via pinia-plugin-persistedstate).
// Repo data lives in the repo store and is intentionally NOT persisted.

import { acceptHMRUpdate } from 'pinia';
import { z } from 'zod';
import type { DiffMode } from '@/stores/repo';

export type FileView = 'list' | 'tree';
export type Accent = 'default' | 'blue' | 'violet' | 'green' | 'amber' | 'rose';

// Coerce a numeric setting to a whole number inside [min, max]; anything that
// isn't a number (a stale/edited persisted value, an out-of-range entry) falls
// back to the lower bound. This is the single validation point for the numeric
// settings — the inputs stay plain, the store guarantees the invariant.
function clampInt({
  value,
  min,
  max
}: {
  value: unknown;
  min: number;
  max: number;
}): number {
  return z
    .number()
    .catch(min)
    .transform((n) => Math.min(max, Math.max(min, Math.round(n))))
    .parse(value);
}

export const useLayoutStore = defineStore('layout', {
  state: () => ({
    sidebarOpen: true,
    // Expanded sidebar width in px, settable directly or by drag within
    // [192, 512] (12–32rem). Default 256 (16rem).
    sidebarWidth: 256,
    // Whether the drag-to-resize handle is active (the width is still settable
    // numerically when off).
    sidebarResizable: true,
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
    // Recent projects: how many to keep (max), and how many to surface on the
    // start screen and in the command palette. The two display counts are capped
    // to the max at read time, so they always stay <= recentReposMax.
    recentReposMax: 12,
    recentReposOnPage: 8,
    recentReposInSearch: 6,
    // Recently-used command-palette actions: how many to keep, and how many to
    // surface in the palette's "recently used" group.
    recentActionsMax: 12,
    recentActionsInSearch: 6,
    // Extra locales whose translations the command palette also indexes for
    // search, on top of the active UI language (e.g. a German user typing
    // English command names). `null` = never initialised: the locale-dependent
    // default is materialised once on first launch (see initSearchLocales).
    // `[]` = the user deliberately cleared it; we then leave it alone.
    searchLocales: null as string[] | null,
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
    // Update channel: stable releases, opt-in beta builds, or a hand-picked
    // experiment (a per-branch build).
    releaseChannel: 'stable' as 'stable' | 'beta' | 'experiment',
    // Experiment channel: the cached list of active experiment slugs, the one
    // the user picked, and when the list was last fetched (for the throttled
    // manual refresh — see useExperiments).
    experiments: [] as string[],
    selectedExperiment: '',
    experimentsFetchedAt: 0,
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
    },
    // Materialise the locale-dependent default for additional search languages,
    // but only on first launch (searchLocales still null). English UI → none;
    // any other language → English added, so non-English users can also type
    // English command names. Keyed off null so a user who clears the list (→ [])
    // is not re-defaulted on the next launch.
    initSearchLocales(activeLocale: string) {
      if (this.searchLocales !== null) return;
      this.searchLocales = activeLocale.toLowerCase().startsWith('en')
        ? []
        : ['en-GB'];
    },
    setSearchLocales(codes: string[]) {
      this.searchLocales = codes;
    },
    // Clamp every numeric setting back into its valid range (whole number, in
    // bounds, display counts never above their max sibling). Run after hydration
    // and whenever the settings dialog closes, so a typed or restored
    // out-of-range value can't take effect.
    normalizeNumbers() {
      this.sidebarWidth = clampInt({
        value: this.sidebarWidth,
        min: 192,
        max: 512
      });
      this.recentReposMax = clampInt({
        value: this.recentReposMax,
        min: 1,
        max: 50
      });
      this.recentReposOnPage = clampInt({
        value: this.recentReposOnPage,
        min: 0,
        max: this.recentReposMax
      });
      this.recentReposInSearch = clampInt({
        value: this.recentReposInSearch,
        min: 0,
        max: this.recentReposMax
      });
      this.recentActionsMax = clampInt({
        value: this.recentActionsMax,
        min: 0,
        max: 50
      });
      this.recentActionsInSearch = clampInt({
        value: this.recentActionsInSearch,
        min: 0,
        max: this.recentActionsMax
      });
      this.autoFetchMinutes = clampInt({
        value: this.autoFetchMinutes,
        min: 1,
        max: 120
      });
    }
  },
  persist: {
    // Validate persisted numeric settings on load so an out-of-range value left
    // in localStorage (older build, hand-edited) is corrected immediately.
    afterHydrate: (ctx) => ctx.store.normalizeNumbers()
  }
});

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLayoutStore, import.meta.hot));
}
