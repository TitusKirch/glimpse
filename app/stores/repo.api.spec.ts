// @vitest-environment happy-dom
//
// The repo store's public surface, pinned name by name.
//
// `useRepoStore` is the seam every panel talks to, imported across the app. Its
// implementation is split across `app/stores/repo/*`, and a split is exactly
// the change that can silently drop a member: an action left out of a spread, a
// getter that moved and never came back, a rename that only half landed.
// Nothing else in the suite would notice — a component calling a missing action
// fails at runtime, in the shell, in front of a user.
//
// So the lists below are a literal inventory of the surface as it stood before
// the split, kept independently of the store's own source: they are the
// specification, not a re-derivation of it. Adding a member means adding it
// here on purpose; losing one fails here.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, defineStore, setActivePinia } from 'pinia';

const isTauriProbe = vi.fn(() => false);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: isTauriProbe
}));

const g = globalThis as Record<string, unknown>;
const { isTauri } = await import('../composables/isTauri');
const { gitMock } = await import('../composables/gitMock');
g.defineStore = defineStore;
g.isTauri = isTauri;
g.gitMock = gitMock;
g.gitClient = { info: vi.fn(), watchRepo: vi.fn() };
const { cleanGitError } = await import('../composables/cleanGitError');
g.cleanGitError = cleanGitError;
const { useSessionStore } = await import('./session');
g.useSessionStore = useSessionStore;
g.useChangelistsStore = () => ({ release: () => Promise.resolve() });

const { useRepoStore } = await import('./repo');

// Top-level state: the transient UI bits plus the multi-repo bookkeeping.
const STATE = [
  'repos',
  'order',
  'activeId',
  'seq',
  'commitMessage',
  'amend',
  'lastRefresh',
  'lastError',
  'busy',
  'loading',
  'syncing',
  'refreshing',
  'loadingMore',
  'multiSel'
];

// Getters: the active repo, the tab strip, and the flat projections the panels
// read instead of reaching into `repos[activeId]` themselves.
const GETTERS = [
  'active',
  'activeTabId',
  'ahead',
  'behind',
  'bisectInProgress',
  'branches',
  'commitFiles',
  'commits',
  'conflictedFiles',
  'currentBranch',
  'diff',
  'hasMoreHistory',
  'hasRepos',
  'loadError',
  'loaded',
  'rebaseInProgress',
  'remoteBranches',
  'remotes',
  'repoPath',
  'selectedBody',
  'selectedCommit',
  'selectedFile',
  'selectedFileStaged',
  'selectedHash',
  'stagedFiles',
  'stashes',
  'status',
  'tabs',
  'tags',
  'unstagedFiles'
];

// Actions, including the internal primitives (`native`, `guarded`, `mutate`,
// `loadStatus`, `loadLog`) — they are called across module boundaries and by
// the specs, so they are part of the surface whether or not a component uses
// them.
const ACTIONS = [
  'addRemote',
  'applyHunk',
  'applyLines',
  'applyPatch',
  'bisectMark',
  'bisectReset',
  'bisectStart',
  'branchAt',
  'checkout',
  'checkoutCommit',
  'checkoutRemote',
  'cherryPick',
  'cherryPickSelected',
  'clearError',
  'cloneRepo',
  'closeRepo',
  'commit',
  'commitList',
  'commitPartial',
  'createBranch',
  'createBranchPrompt',
  'createTag',
  'createTagPrompt',
  'deleteBranch',
  'deleteTag',
  'discard',
  'discardAll',
  'discardHunk',
  'doOpenRepo',
  'doPull',
  'doSync',
  'exportPatch',
  'guarded',
  'initRepo',
  'interactiveRebase',
  'loadFromBackend',
  'loadLog',
  'loadMoreHistory',
  'loadStatus',
  'merge',
  'mergeCurrentInto',
  'mutate',
  'native',
  'openIn',
  'openRepo',
  'orderedSelection',
  'pull',
  'push',
  'pushTags',
  'reDiff',
  'rebaseAbort',
  'rebaseCommits',
  'rebaseContinue',
  'rebaseOnto',
  'rebaseSkip',
  'refresh',
  'releaseIdleTabs',
  'releaseTab',
  'reloadActive',
  'removeRemote',
  'renameBranch',
  'renameBranchPrompt',
  'renameRemote',
  'reorderTabs',
  'reset',
  'resolveConflict',
  'resolveTabPlatforms',
  'restoreSession',
  'retryLoad',
  'revert',
  'revertSelected',
  'rowClick',
  'runBisectStep',
  'runRebaseStep',
  'saveResolution',
  'selectCommit',
  'selectCommitFile',
  'selectFile',
  'selectTab',
  'setAmend',
  'sparseDisable',
  'sparseSet',
  'stage',
  'stashAction',
  'stashSave',
  'submoduleSync',
  'submoduleUpdate',
  'sync',
  'syncSession',
  'tagAt',
  'undoLast',
  'unstage',
  'watchActive',
  'worktreeAdd',
  'worktreeRemove'
];

beforeEach(() => {
  setActivePinia(createPinia());
  isTauriProbe.mockReturnValue(false);
});

describe('repo store public surface', () => {
  it.each(STATE)('carries the state field %s', (name) => {
    expect(useRepoStore()).toHaveProperty(name);
  });

  it.each(GETTERS)('exposes the getter %s', (name) => {
    const store = useRepoStore() as unknown as Record<string, unknown>;
    expect(name in store).toBe(true);
    // A getter reads; an action does not. This is what catches a projection
    // that was extracted as a method and now has to be called to get a value.
    expect(typeof store[name]).not.toBe('function');
  });

  it.each(ACTIONS)('exposes the action %s', (name) => {
    const store = useRepoStore() as unknown as Record<string, unknown>;
    expect(typeof store[name]).toBe('function');
  });

  it('exposes nothing beyond the pinned surface', () => {
    const known = new Set([...STATE, ...GETTERS, ...ACTIONS]);
    const extra = Object.keys(useRepoStore()).filter(
      (k) => !k.startsWith('$') && !k.startsWith('_') && !known.has(k)
    );
    expect(extra).toEqual([]);
  });
});
