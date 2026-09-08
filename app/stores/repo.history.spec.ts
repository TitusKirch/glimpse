// @vitest-environment happy-dom
//
// How much history is loaded belongs to a repository tab, not to the
// application. When the limit was one app-wide counter, "load more history" in
// one tab silently raised what *every* other open tab fetched on its next load
// — and nothing ever brought it back down, so the cost was the raised limit
// times the number of open tabs, in commits retained and in graph nodes drawn.
// These tests pin both halves: a raise reaches only the tab that asked, and it
// survives that tab's own later loads instead of snapping back.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, defineStore, setActivePinia } from 'pinia';

const isTauriProbe = vi.fn(() => true);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: isTauriProbe
}));

const g = globalThis as Record<string, unknown>;
const { isTauri } = await import('../composables/isTauri');
const { gitMock } = await import('../composables/gitMock');
const { restoreSelection } = await import('../utils/selectionRestore');

// Only the log call matters here, so it records its arguments; the rest is the
// smallest stub that lets a tab open and finish loading.
const log = vi.fn(async (_opts: { path: string; limit: number }) => []);
const gitClientStub = {
  log,
  info: vi.fn(async (path: string) => ({
    toplevel: path,
    flavor: 'linux',
    distro: null,
    branches: [],
    remoteBranches: [],
    currentBranch: 'main',
    remotes: [],
    tags: [],
    stashes: [],
    rebaseInProgress: false,
    bisectInProgress: false
  })),
  status: vi.fn(async () => []),
  watchRepo: vi.fn(async () => {})
};

// Nuxt auto-imports the store reaches as free globals.
g.defineStore = defineStore;
g.isTauri = isTauri;
g.gitMock = gitMock;
g.restoreSelection = restoreSelection;
g.cleanGitError = (raw: string) => raw;
g.useRecentStore = () => ({ push: () => {} });
// `closeRepo` releases the closed repo's changelist state (#186); this spec is
// about history depth, so the store only has to exist for that call.
g.useChangelistsStore = () => ({ release: () => Promise.resolve() });
g.useSessionStore = () => ({
  openPaths: [],
  activePath: '',
  initialized: false
});
g.gitClient = gitClientStub;

const { useRepoStore } = await import('./repo');

// The limits the log was asked for, in call order.
function limits(): number[] {
  return log.mock.calls.map(([opts]) => opts.limit);
}

function limitFor(path: string): number[] {
  return log.mock.calls.filter(([o]) => o.path === path).map(([o]) => o.limit);
}

// "Load more" floors its spinner at 300ms so it can't flash; drive that clock
// rather than waiting on it.
async function loadMore(repo: ReturnType<typeof useRepoStore>) {
  const pending = repo.loadMoreHistory();
  await vi.advanceTimersByTimeAsync(300);
  await pending;
}

beforeEach(() => {
  setActivePinia(createPinia());
  isTauriProbe.mockReturnValue(true);
  log.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('history depth is per repository tab', () => {
  it('opens every tab at one page of history', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo-a');
    await repo.openRepo('/repo-b');

    expect(repo.order).toHaveLength(2);
    expect(limits()).toEqual([200, 200]);
  });

  it('leaves the other tabs at one page when one asks for more', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo-a');
    await repo.openRepo('/repo-b');
    const [a, b] = repo.order;

    repo.activeId = a!;
    await loadMore(repo);
    await loadMore(repo);
    log.mockClear();

    // B reloads for its own reasons (tab switch, watcher, window focus) and
    // must still fetch the page it was opened with.
    repo.activeId = b!;
    await repo.loadLog();
    expect(limitFor('/repo-b')).toEqual([200]);
  });

  it('keeps a tab at the depth it asked for on its own later loads', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo-a');
    const [a] = repo.order;

    repo.activeId = a!;
    await loadMore(repo);
    await loadMore(repo);
    log.mockClear();

    await repo.loadLog();
    await repo.loadLog();
    expect(limitFor('/repo-a')).toEqual([600, 600]);
  });

  it('raises the tab that asked, not whichever tab is active when it lands', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo-a');
    await repo.openRepo('/repo-b');
    const [a, b] = repo.order;

    repo.activeId = a!;
    const pending = repo.loadMoreHistory();
    // The user switches away while the deeper page is still in flight.
    repo.activeId = b!;
    await vi.advanceTimersByTimeAsync(300);
    await pending;
    log.mockClear();

    await repo.loadLog();
    expect(limitFor('/repo-b')).toEqual([200]);
  });

  it('takes a raised depth away with the tab that is closed', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo-a');
    const [a] = repo.order;

    repo.activeId = a!;
    await loadMore(repo);
    repo.closeRepo(a!);
    log.mockClear();

    // Reopening is a fresh tab, so the walk back through history starts over
    // rather than resurrecting a depth from a tab the user shut.
    await repo.openRepo('/repo-a');
    expect(limitFor('/repo-a')).toEqual([200]);
  });
});
