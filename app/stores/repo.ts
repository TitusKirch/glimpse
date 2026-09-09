// Repo store. Talks to the Rust/Tauri git backend when running in the desktop
// shell; falls back to mock data in the browser so the UI stays developable.
//
// Multi-repo: each open repository is one RepoState (its identity + its whole
// view — branches, commits, status, diff, selection). The store keeps them
// keyed by id with an activeId; projection getters expose the active repo, so
// switching tabs swaps the entire graph + diff. Transient UI bits
// (commitMessage, busy, lastError) stay at the top level.
//
// This file is the seam and nothing else: state, the projections over it, and
// the composed action set. Every action body lives in `./repo/`, one module per
// responsibility — the tab lifecycle, loading, selection, the working tree,
// branches, history rewriting, refs, remote sync, the side tools — and each one
// reaches the store back through `useRepoStore()`. So `useRepoStore` stays the
// single public entry point every panel imports, while no one part of it can
// grow without a visible home to grow in.
//
// The IPC payload shapes are the single source of truth in
// src-tauri/crates/glimpse-core/src/git.rs;
// app/types/bindings.ts is generated from them (ts-rs). Re-exported here so the
// rest of the app keeps importing these names from the store.
import { acceptHMRUpdate } from 'pinia';
import type {
  BlameLine,
  Branch,
  Commit,
  CommitFile,
  DiffData,
  RepoInfo,
  StashEntry,
  StatusEntry
} from '~/types/bindings';
import { branchActions } from '~/stores/repo/branches';
import { effectActions } from '~/stores/repo/effects';
import { loadingActions } from '~/stores/repo/loading';
import { refActions } from '~/stores/repo/refs';
import { rewriteActions } from '~/stores/repo/rewrite';
import { selectionActions } from '~/stores/repo/selection';
import { demoRepo } from '~/stores/repo/state';
import type { RepoState } from '~/stores/repo/state';
import { syncActions } from '~/stores/repo/sync';
import { tabActions } from '~/stores/repo/tabs';
import { toolActions } from '~/stores/repo/tools';
import { workingTreeActions } from '~/stores/repo/workingTree';

export type {
  BlameLine,
  Branch,
  Commit,
  CommitFile,
  DiffData,
  RepoInfo,
  StashEntry,
  StatusEntry
};

// The per-tab shape and the helpers over it moved to ./repo/state.ts; the app
// (and the specs) still import them from the store, which is where they read as
// part of its vocabulary.
export type { DiffMode, GitFlavor, RepoState } from '~/stores/repo/state';
export { isResolvingPlatform, MAX_LOADED_TABS } from '~/stores/repo/state';

export const useRepoStore = defineStore('repo', {
  state: () => ({
    // The demo repo is browser-only scaffolding, and seeding it in the desktop
    // shell is actively harmful: its \\wsl$ path is fictional, but the shell
    // runs real git. restoreSession() replaces these three fields with the real
    // tabs — only afterwards, so anything reading `active.path` during boot
    // (useConventionalCommits) fires git at the fiction first. That call always
    // failed; since the global error plugin it is fatal, and the start screen
    // became a crash. Start empty instead and let restoreSession() fill in.
    repos: (isTauri() ? {} : { r1: demoRepo() }) as Record<string, RepoState>,
    order: (isTauri() ? [] : ['r1']) as string[],
    activeId: isTauri() ? '' : 'r1',
    // Monotonic counter for unique tab ids; starts past whatever state seeded.
    seq: isTauri() ? 0 : 1,
    commitMessage: '',
    // Rewrite the previous commit instead of creating a new one.
    amend: false,
    lastRefresh: 'just now',
    lastError: null as string | null,
    busy: false,
    // True while the active repo's git data loads — drives loading skeletons.
    loading: false,
    // Which remote sync (if any) is in flight — drives the button spinner.
    syncing: null as 'fetch' | 'pull' | 'push' | null,
    refreshing: false,
    loadingMore: false,
    // Multi-selected commit hashes in the graph (Ctrl/Shift-click) for bulk
    // cherry-pick / revert. Cleared on a plain click or tab switch.
    multiSel: [] as string[]
  }),
  getters: {
    // The active repository and the tab strip over all open ones. `active` is
    // undefined when every tab is closed (the start screen shows instead), so
    // the projections below all fall back to safe empties.
    active: (s): RepoState | undefined => s.repos[s.activeId],
    tabs: (s): RepoState[] => s.order.map((id) => s.repos[id]!),
    activeTabId: (s): string => s.activeId,
    hasRepos: (s): boolean => s.order.length > 0,

    // Projections of the active repo — keep the panel-facing API flat.
    repoPath(): string {
      return this.active?.path ?? '.';
    },
    branches(): Branch[] {
      return this.active?.branches ?? [];
    },
    remoteBranches(): string[] {
      return this.active?.remoteBranches ?? [];
    },
    currentBranch(): string {
      return this.active?.currentBranch ?? '';
    },
    remotes(): string[] {
      return this.active?.remotes ?? [];
    },
    tags(): string[] {
      return this.active?.tags ?? [];
    },
    stashes(): StashEntry[] {
      return this.active?.stashes ?? [];
    },
    commits(): Commit[] {
      return this.active?.commits ?? [];
    },
    status(): StatusEntry[] {
      return this.active?.status ?? [];
    },
    rebaseInProgress(): boolean {
      return this.active?.rebaseInProgress ?? false;
    },
    bisectInProgress(): boolean {
      return this.active?.bisectInProgress ?? false;
    },
    selectedHash(): string | null {
      return this.active?.selectedHash ?? null;
    },
    selectedBody(): string {
      return this.active?.selectedBody ?? '';
    },
    selectedFile(): string | null {
      return this.active?.selectedFile ?? null;
    },
    selectedFileStaged(): boolean {
      return this.active?.selectedFileStaged ?? false;
    },
    commitFiles(): CommitFile[] {
      return this.active?.commitFiles ?? [];
    },
    diff(): DiffData | null {
      return this.active?.diff ?? null;
    },
    // True once the active repo's git data has loaded at least once. Skeletons
    // gate on `loading && !loaded` so they show only on the first load, not on
    // background refreshes (window focus, manual refetch) where the data — even
    // an empty list — is already on screen and should stay put.
    loaded(): boolean {
      return this.active?.loaded ?? false;
    },
    selectedCommit(): Commit | null {
      const r = this.active;
      if (!r) return null;
      return r.commits.find((c) => c.hash === r.selectedHash) ?? null;
    },
    stagedFiles(): StatusEntry[] {
      return this.status.filter((f) => f.staged);
    },
    unstagedFiles(): StatusEntry[] {
      return this.status.filter((f) => f.unstaged || f.untracked);
    },
    conflictedFiles(): StatusEntry[] {
      return this.status.filter((f) => f.conflicted);
    },
    // How far the current branch is behind its upstream — drives the "incoming
    // commits" badge on the pull button after a (manual or auto) fetch.
    behind(): number {
      const b = this.branches.find((x) => x.name === this.currentBranch);
      return b?.behind ?? 0;
    },
    // How far the current branch is ahead of its upstream — drives the
    // "unpushed commits" badge on the push button.
    ahead(): number {
      const b = this.branches.find((x) => x.name === this.currentBranch);
      return b?.ahead ?? 0;
    },
    // The active tab's last log fetch hit its limit, so more history can be
    // loaded. Read off the tab so a load elsewhere never answers for it.
    hasMoreHistory(): boolean {
      return this.active?.hasMore ?? false;
    },
    // The active tab's load failure, if it has one. A failure on another tab
    // stays on that tab until the user switches to it.
    loadError(): string | null {
      return this.active?.loadError ?? null;
    }
  },
  // One flat action surface, composed from the modules rather than written
  // here. Spreading (not re-declaring) is deliberate: a delegating wrapper per
  // action would be ninety more places for a signature to drift out of step
  // with the body it forwards to, and the point of the split is fewer such
  // places, not more.
  actions: {
    ...effectActions,
    ...loadingActions,
    ...tabActions,
    ...selectionActions,
    ...workingTreeActions,
    ...branchActions,
    ...rewriteActions,
    ...refActions,
    ...syncActions,
    ...toolActions
  }
});

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRepoStore, import.meta.hot));
}
