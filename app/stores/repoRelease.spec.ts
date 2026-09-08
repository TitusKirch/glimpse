// @vitest-environment happy-dom
// Two properties of the repo store's memory behaviour (#195):
//
//  1. An idle tab gives its git data back, and getting it back is invisible —
//     re-activating the tab has to land on the same commit and the same diff.
//     A release that quietly moved the user's selection would cost far more
//     than the memory it saves, so the selection is what these tests guard.
//  2. The big git payloads are stored raw rather than deeply reactive. Raw
//     means "replaced, never mutated", so each one is checked both ways: no
//     proxy on the way in, and the readers still repaint when it is replaced.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { isReactive, nextTick, watchEffect } from 'vue';
import type {
  Commit,
  CommitFile,
  DiffData,
  RepoInfo,
  StatusEntry
} from '../types/bindings';

function commit(hash: string): Commit {
  return {
    hash,
    subject: `subject ${hash}`,
    author: 'Titus Kirch',
    date: '2026-05-30',
    refs: [],
    parents: [],
    lane: 0,
    signatureStatus: '',
    signerName: '',
    signerKey: ''
  };
}

function statusEntry(path: string): StatusEntry {
  return {
    path,
    x: ' ',
    y: 'M',
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    isLfs: false
  };
}

function diffData(fileName: string): DiffData {
  return {
    fileName,
    oldContent: 'old',
    newContent: 'new',
    hunks: ['@@ -1 +1 @@'],
    isLfs: false,
    contentsOmitted: false
  };
}

// What the stub backend handed out last, so a test can assert the store kept
// the very object git produced — the observable difference between a raw
// snapshot and a deeply reactive copy of it.
let lastCommits: Commit[] = [];
let lastStatus: StatusEntry[] = [];
let lastCommitFiles: CommitFile[] = [];
let lastDiff: DiffData | null = null;

const backend = {
  watchRepo: vi.fn(async () => null),
  defaultRepo: vi.fn(async () => '/repo/1'),
  info: vi.fn(async (path: string): Promise<RepoInfo> => ({
    toplevel: path,
    currentBranch: 'main',
    branches: [{ name: 'main', ahead: 0, behind: 0, published: true }],
    remoteBranches: ['origin/main'],
    remotes: ['origin'],
    tags: ['v1'],
    stashes: [],
    rebaseInProgress: false,
    bisectInProgress: false,
    flavor: 'linux',
    distro: null
  })),
  log: vi.fn(async () => {
    lastCommits = [commit('aaa1111'), commit('bbb2222')];
    return lastCommits;
  }),
  status: vi.fn(async () => {
    lastStatus = [statusEntry('a.txt')];
    return lastStatus;
  }),
  commitBody: vi.fn(async () => 'commit body'),
  commitFiles: vi.fn(async () => {
    lastCommitFiles = [{ path: 'a.txt', status: 'M' }];
    return lastCommitFiles;
  }),
  commitFileDiff: vi.fn(async () => {
    lastDiff = diffData('a.txt');
    return lastDiff;
  }),
  fileDiff: vi.fn(async () => {
    lastDiff = diffData('a.txt');
    return lastDiff;
  })
};

// The store reaches these as Nuxt auto-imports (free globals). Stub them before
// importing the store module, which calls them at action time.
const g = globalThis as Record<string, unknown>;
g.defineStore = defineStore;
g.isTauri = () => true;
g.gitMock = { commits: [], status: [], diff: null };
g.gitClient = backend;
g.cleanGitError = (raw: string) => raw;
g.useSessionStore = () => ({
  openPaths: [],
  activePath: '',
  initialized: true
});
g.useRecentStore = () => ({ push: () => {} });
// `closeRepo` releases the closed repo's changelist state (#186); this spec is
// about releasing idle tabs, so the store only has to exist for that call.
g.useChangelistsStore = () => ({ release: () => Promise.resolve() });
g.useLayoutStore = () => ({ ignoreWhitespace: false });
g.useSettingsStore = () => ({ diffMode: 'split' });

const { restoreSelection } = await import('../utils/selectionRestore');
g.restoreSelection = restoreSelection;

const { MAX_LOADED_TABS, useRepoStore } = await import('./repo');

type Store = ReturnType<typeof useRepoStore>;

// Open `count` repos, each in its own tab, oldest first.
async function openTabs(repo: Store, count: number) {
  for (let n = 1; n <= count; n += 1) await repo.openRepo(`/repo/${n}`);
}

function tabAt(repo: Store, path: string) {
  return repo.tabs.find((t) => t.path === path)!;
}

beforeEach(() => {
  setActivePinia(createPinia());
  for (const fn of Object.values(backend)) fn.mockClear();
});

describe('repo store: an idle tab releases its git data (#195)', () => {
  it('loads every tab and keeps it while the budget is not exceeded', async () => {
    const repo = useRepoStore();
    await openTabs(repo, MAX_LOADED_TABS);
    expect(repo.tabs).toHaveLength(MAX_LOADED_TABS);
    expect(repo.tabs.every((t) => t.loaded)).toBe(true);
    expect(repo.lastError).toBeNull();
    expect(repo.loadError).toBeNull();
  });

  it('releases the least recently used tab once one more repo is opened', async () => {
    const repo = useRepoStore();
    await openTabs(repo, MAX_LOADED_TABS + 1);
    const idle = tabAt(repo, '/repo/1');
    expect(idle.loaded).toBe(false);
    expect(idle.commits).toEqual([]);
    expect(idle.status).toEqual([]);
    expect(idle.commitFiles).toEqual([]);
    expect(idle.diff).toBeNull();
    expect(idle.selectedBody).toBe('');
    // Every tab the budget covers keeps its data.
    expect(repo.tabs.filter((t) => t.loaded)).toHaveLength(MAX_LOADED_TABS);
  });

  it('keeps a released tab identifiable, so the tab strip still renders it', async () => {
    const repo = useRepoStore();
    await openTabs(repo, MAX_LOADED_TABS + 1);
    const idle = tabAt(repo, '/repo/1');
    expect(idle.name).toBe('1');
    expect(idle.path).toBe('/repo/1');
    expect(idle.flavor).toBe('linux');
    // A released tab is settled, not probing — its icon must not spin.
    expect(idle.resolving).toBe(false);
    // Branch metadata is O(refs), not O(history): kept so the reloading tab
    // paints its last known branch instead of going blank.
    expect(idle.currentBranch).toBe('main');
    expect(idle.branches).toHaveLength(1);
  });

  it('never releases the tab being activated', async () => {
    const repo = useRepoStore();
    await openTabs(repo, MAX_LOADED_TABS + 1);
    await repo.selectTab(tabAt(repo, '/repo/1').id);
    expect(tabAt(repo, '/repo/1').loaded).toBe(true);
    expect(repo.activeId).toBe(tabAt(repo, '/repo/1').id);
    // Re-activating repo 1 pushes repo 2 out of the budget instead.
    expect(tabAt(repo, '/repo/2').loaded).toBe(false);
  });

  it('reloads a released tab on re-activation', async () => {
    const repo = useRepoStore();
    await openTabs(repo, MAX_LOADED_TABS + 1);
    backend.log.mockClear();
    await repo.selectTab(tabAt(repo, '/repo/1').id);
    expect(backend.log).toHaveBeenCalledTimes(1);
    expect(repo.commits).toHaveLength(2);
    expect(repo.status).toHaveLength(1);
  });

  it('loads the neighbour a tab close activates, released or not', async () => {
    const repo = useRepoStore();
    await openTabs(repo, MAX_LOADED_TABS + 1);
    // Re-activating repo 1 pushes repo 2 out, and puts the released tab right
    // next to the tab about to be closed.
    await repo.selectTab(tabAt(repo, '/repo/1').id);
    expect(tabAt(repo, '/repo/2').loaded).toBe(false);

    repo.closeRepo(tabAt(repo, '/repo/1').id);
    expect(repo.activeId).toBe(tabAt(repo, '/repo/2').id);
    // A close must not block on git, so the load it starts is awaited here.
    await vi.waitFor(() => expect(tabAt(repo, '/repo/2').loaded).toBe(true));
    expect(repo.commits).toHaveLength(2);
  });

  it('restores the same commit and diff when a released tab comes back', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo/1');
    await repo.selectCommit('bbb2222');
    expect(repo.selectedHash).toBe('bbb2222');

    await openTabs(repo, MAX_LOADED_TABS + 1);
    const idle = tabAt(repo, '/repo/1');
    // The selection is the one thing a reload cannot rediscover — it has to
    // survive the release, or the user comes back to a different commit.
    expect(idle.loaded).toBe(false);
    expect(idle.selectedHash).toBe('bbb2222');

    await repo.selectTab(idle.id);
    expect(repo.selectedHash).toBe('bbb2222');
    expect(repo.selectedBody).toBe('commit body');
    expect(repo.commitFiles).toHaveLength(1);
    expect(repo.diff?.fileName).toBe('a.txt');
  });

  it('restores the same working-tree file when a released tab comes back', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo/1');
    await repo.selectFile({ file: 'a.txt', staged: false });
    expect(repo.selectedFile).toBe('a.txt');

    await openTabs(repo, MAX_LOADED_TABS + 1);
    const idle = tabAt(repo, '/repo/1');
    expect(idle.selectedFile).toBe('a.txt');
    expect(idle.selectedFileStaged).toBe(false);

    await repo.selectTab(idle.id);
    expect(repo.selectedHash).toBeNull();
    expect(repo.selectedFile).toBe('a.txt');
    expect(repo.diff?.fileName).toBe('a.txt');
  });
});

describe('repo store: git payloads are raw snapshots (#195)', () => {
  it('keeps the working-tree status exactly as git handed it over', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo/1');
    expect(isReactive(repo.status)).toBe(false);
    expect(repo.status).toBe(lastStatus);
    expect(repo.status[0]).toBe(lastStatus[0]);
  });

  it('keeps a commit file list exactly as git handed it over', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo/1');
    await repo.selectCommit('aaa1111');
    expect(isReactive(repo.commitFiles)).toBe(false);
    expect(repo.commitFiles).toBe(lastCommitFiles);
  });

  it('keeps a diff exactly as git handed it over', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo/1');
    await repo.selectFile({ file: 'a.txt', staged: false });
    expect(isReactive(repo.diff)).toBe(false);
    expect(repo.diff).toBe(lastDiff);
  });

  it('still repaints the changes panel when the status is replaced', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo/1');
    const seen: number[] = [];
    const stop = watchEffect(() => seen.push(repo.status.length));
    backend.status.mockImplementationOnce(async () => {
      lastStatus = [statusEntry('a.txt'), statusEntry('b.txt')];
      return lastStatus;
    });
    await repo.loadStatus();
    await nextTick();
    stop();
    expect(seen).toEqual([1, 2]);
  });

  it('still repaints the diff viewer when the diff is replaced', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo/1');
    await repo.selectFile({ file: 'a.txt', staged: false });
    const seen: (string | undefined)[] = [];
    const stop = watchEffect(() => seen.push(repo.diff?.fileName));
    backend.fileDiff.mockImplementationOnce(async () => {
      lastDiff = diffData('b.txt');
      return lastDiff;
    });
    await repo.selectFile({ file: 'b.txt', staged: false });
    await nextTick();
    stop();
    expect(seen).toEqual(['a.txt', 'b.txt']);
  });
});
