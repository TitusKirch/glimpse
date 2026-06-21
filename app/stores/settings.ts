// The user's real, persisted settings — the values surfaced in the settings
// dialog. Kept separate from the `layout` store, which now holds only ephemeral
// view state (panel sizes, sidebar open/edit/order, the active left tab, the
// diff whitespace toggle). Every setting is read through the generic, dependency
// -aware `get` accessor: callers ask for a setting by name and get its
// *effective* value, with any dependencies resolved here rather than recombined
// at each call site.

import { acceptHMRUpdate } from 'pinia';
import { z } from 'zod';
import type { DiffMode } from '@/stores/repo';
import type { Accent, FileView, PullStrategy } from '@/stores/layout';

export type ReleaseChannel = 'stable' | 'beta' | 'experiment';

// The shape of the persisted settings. One field per setting; the generic
// accessor and the effective resolvers below are typed against this.
export interface SettingsValues {
  // Extra locales the command palette also indexes (null = never initialised).
  searchLocales: string[] | null;
  pullStrategy: PullStrategy;
  releaseChannel: ReleaseChannel;
  selectedExperiment: string;
  // Cached experiment list + when it was last fetched (see useExperiments).
  experiments: string[];
  experimentsFetchedAt: number;
  // Opt in to per-branch experiment builds; only effective in developer mode.
  experimentsEnabled: boolean;
  // Developer mode: unlocks Showcase/Triggers and the pre-release channels.
  devMode: boolean;
  autoFetch: boolean;
  autoFetchMinutes: number;
  autoUpdate: boolean;
  recentReposMax: number;
  recentReposOnPage: number;
  recentReposInSearch: number;
  recentActionsMax: number;
  recentActionsInSearch: number;
  sidebarResizable: boolean;
  sidebarWidth: number;
  // Hide sidebar sections (branches, remotes, …) that have no items, instead of
  // showing a "none yet" placeholder. Off by default.
  hideEmptySidebarSections: boolean;
  diffMode: DiffMode;
  // Soft-wrap long lines in the diff viewer (unified view).
  diffWrap: boolean;
  fileView: FileView;
  // Group pending changes into named changelists in the Changes panel instead of
  // the plain staged/unstaged view. On by default.
  changelists: boolean;
  // Show the per-hunk "Review & commit hunks…" step in the changelist panel, to
  // commit only part of a file. Off by default — the review UX is still rough
  // (see #106); this opts into it.
  changelistHunkCommit: boolean;
  monoScale: number;
  accent: Accent;
  shortenDependabot: boolean;
  // Cached installed path of the `glimpse` CLI launcher (null = not on PATH /
  // not yet checked). Not a user setting — persisted only so the settings button
  // shows the right state instantly, with no enabled→disabled flash. Refreshed on
  // boot and on each dialog open (see useCliInstall).
  cliInstalled: string | null;
}

// The keys copied over on first upgrade from the old combined `layout` store.
const MIGRATED_KEYS = [
  'searchLocales',
  'pullStrategy',
  'releaseChannel',
  'selectedExperiment',
  'experiments',
  'experimentsFetchedAt',
  'experimentsEnabled',
  'devMode',
  'autoFetch',
  'autoFetchMinutes',
  'autoUpdate',
  'recentReposMax',
  'recentReposOnPage',
  'recentReposInSearch',
  'recentActionsMax',
  'recentActionsInSearch',
  'sidebarResizable',
  'sidebarWidth',
  'diffMode',
  'diffWrap',
  'fileView',
  'monoScale',
  'accent',
  'shortenDependabot'
] as const satisfies readonly (keyof SettingsValues)[];

// Dependency resolvers: a setting listed here has its effective value derived
// from the raw stored value plus other settings. `get(name)` applies these, so
// the dependency logic lives in exactly one place (no per-setting getters).
type EffectiveResolvers = {
  [K in keyof SettingsValues]?: (s: SettingsValues) => SettingsValues[K];
};
const EFFECTIVE: EffectiveResolvers = {
  // Experiments need the opt-in AND developer mode — off otherwise, whatever the
  // raw toggle says.
  experimentsEnabled: (s) => s.devMode && s.experimentsEnabled,
  // The Experiment channel is only in force while experiments are available;
  // otherwise it falls back to Beta.
  releaseChannel: (s) =>
    s.releaseChannel === 'experiment' && !(s.devMode && s.experimentsEnabled)
      ? 'beta'
      : s.releaseChannel
};

// Coerce a numeric setting to a whole number inside [min, max]; anything that
// isn't a number (a stale/edited persisted value, an out-of-range entry) falls
// back to the lower bound. The single validation point for the numeric settings.
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

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsValues => ({
    searchLocales: null,
    pullStrategy: 'merge',
    releaseChannel: 'stable',
    selectedExperiment: '',
    experiments: [],
    experimentsFetchedAt: 0,
    experimentsEnabled: false,
    devMode: false,
    autoFetch: false,
    autoFetchMinutes: 5,
    autoUpdate: true,
    recentReposMax: 12,
    recentReposOnPage: 8,
    recentReposInSearch: 6,
    recentActionsMax: 12,
    recentActionsInSearch: 6,
    sidebarResizable: true,
    sidebarWidth: 256,
    hideEmptySidebarSections: false,
    diffMode: 'split',
    diffWrap: false,
    fileView: 'tree',
    changelists: true,
    changelistHunkCommit: false,
    monoScale: 1,
    accent: 'default',
    shortenDependabot: true,
    cliInstalled: null
  }),
  getters: {
    // Generic, dependency-aware accessor: read any setting by name and get its
    // effective value (dependencies resolved via EFFECTIVE). Replaces the old
    // one-off derived getters such as `experimentsActive`.
    get(): <K extends keyof SettingsValues>(name: K) => SettingsValues[K] {
      const self = this as unknown as SettingsValues;
      return (name) => {
        const resolver = EFFECTIVE[name];
        return resolver ? resolver(self) : self[name];
      };
    }
  },
  actions: {
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
    setDiffMode(mode: DiffMode) {
      this.diffMode = mode;
    },
    toggleDiffWrap() {
      this.diffWrap = !this.diffWrap;
    },
    setFileView(view: FileView) {
      this.fileView = view;
    },
    toggleFileView() {
      this.fileView = this.fileView === 'list' ? 'tree' : 'list';
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
    },
    // Stable and Beta are always available; only Experiment is gated (needs the
    // opt-in + developer mode). Drop a now-inaccessible Experiment selection back
    // to Beta. Run silently on hydrate and after toggling either gate (the
    // settings dialog toasts the change). Returns true if the channel changed.
    normalizeChannel(): boolean {
      if (this.releaseChannel === this.get('releaseChannel')) return false;
      this.releaseChannel = this.get('releaseChannel');
      return true;
    },
    // First upgrade from the combined `layout` store: copy the real settings that
    // used to live there into this store, once — when this store has never been
    // persisted. Leaves the now-unused keys in the old blob; layout re-persists
    // without them on its next change.
    migrate() {
      if (localStorage.getItem('settings')) return;
      const raw = localStorage.getItem('layout');
      if (!raw) return;
      let old: Record<string, unknown>;
      try {
        old = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      const state = this as unknown as Record<string, unknown>;
      for (const key of MIGRATED_KEYS) {
        if (old[key] !== undefined) state[key] = old[key];
      }
    }
  },
  persist: {
    // Migrate from the old store on first upgrade, then validate the persisted
    // values so a stale entry (older build, hand-edited) is corrected at once.
    afterHydrate: (ctx) => {
      ctx.store.migrate();
      ctx.store.normalizeNumbers();
      ctx.store.normalizeChannel();
    }
  }
});

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot));
}
