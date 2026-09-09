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

// How many commits each repository has, keyed by path. A repo with at least as
// many commits as the limit asked for is one with another page behind it.
const commitCount: Record<string, number> = {};
// Paths whose probe fails, so a load for that repository ends in the catch.
const infoFails = new Set<string>();

function commitsFor(path: string, limit: number) {
  const n = Math.min(commitCount[path] ?? 0, limit);
  return Array.from({ length: n }, (_, i) => ({
    hash: `${path}-${i}`,
    subject: 'c',
    author: 'a',
    date: '',
    refs: [],
    parents: [],
    lane: 0,
    signatureStatus: '',
    signerName: '',
    signerKey: ''
  }));
}

// Only the log call matters here, so it records its arguments; the rest is the
// smallest stub that lets a tab open and finish loading.
const log = vi.fn(async (opts: { path: string; limit: number }) =>
  commitsFor(opts.path, opts.limit)
);
const gitClientStub = {
  log,
  // A selected commit is looked up as soon as a load returns commits; neither
  // call has anything to say about depth or failure, so both answer empty.
  commitBody: vi.fn(async () => ''),
  commitFiles: vi.fn(async () => []),
  info: vi.fn(async (path: string) => {
    if (infoFails.has(path)) throw `fatal: cannot read ${path}`;
    return {
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
    };
  }),
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
// about per-tab load state, so the store only has to exist for that call.
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
  for (const key of Object.keys(commitCount)) delete commitCount[key];
  infoFails.clear();
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

// The outcome of a load — whether more history is behind it, and whether it
// failed — belongs to the repository that was loaded, for exactly the reason
// its depth does. A load takes a target, so it runs for a background tab just
// as readily as for the active one; as app-wide state its answer was rendered
// for whichever tab the user happened to be looking at. So a shallow repo
// loading in the background hid another tab's "load more history" button, and a
// repository that failed to open showed its error — with a Retry that reloads
// the wrong repo — on a healthy tab, where nothing was wrong.
describe('a load writes its outcome onto the tab it loaded (#198)', () => {
  it('leaves a tab offering more history when a shallower repo loads behind it', async () => {
    const repo = useRepoStore();
    commitCount['/repo-deep'] = 500;
    commitCount['/repo-shallow'] = 3;
    await repo.openRepo('/repo-deep');
    await repo.openRepo('/repo-shallow');
    const [deep, shallow] = repo.order;

    repo.activeId = deep!;
    // The watcher, or a window-focus refresh, reloads the other tab.
    await repo.loadLog(repo.repos[shallow!]);

    expect(repo.hasMoreHistory).toBe(true);
  });

  it('answers whether there is more history per tab as the user switches', async () => {
    const repo = useRepoStore();
    commitCount['/repo-deep'] = 500;
    commitCount['/repo-shallow'] = 3;
    await repo.openRepo('/repo-deep');
    await repo.openRepo('/repo-shallow');
    const [deep, shallow] = repo.order;

    repo.activeId = deep!;
    expect(repo.hasMoreHistory).toBe(true);
    repo.activeId = shallow!;
    expect(repo.hasMoreHistory).toBe(false);
  });

  it('leaves a healthy tab clear when another repository fails to load', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo-ok');
    await repo.openRepo('/repo-bad');
    const [ok, bad] = repo.order;

    repo.activeId = ok!;
    infoFails.add('/repo-bad');
    await repo.loadFromBackend('/repo-bad', { target: repo.repos[bad!] });

    expect(repo.loadError).toBeNull();
    expect(repo.repos[bad!]!.loadError).toContain('/repo-bad');
  });

  it('keeps the failure on the tab that failed while a healthy tab reloads', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo-ok');
    await repo.openRepo('/repo-bad');
    const [ok, bad] = repo.order;

    infoFails.add('/repo-bad');
    await repo.loadFromBackend('/repo-bad', { target: repo.repos[bad!] });
    repo.activeId = ok!;
    await repo.loadFromBackend('/repo-ok', { target: repo.repos[ok!] });

    // A load elsewhere is not news about the broken repo: its panel must still
    // be there when the user goes back to look at it.
    expect(repo.repos[bad!]!.loadError).toContain('/repo-bad');
    expect(repo.loadError).toBeNull();
  });

  it('clears the failure when the tab that failed loads again', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo-bad');
    const [bad] = repo.order;

    infoFails.add('/repo-bad');
    await repo.loadFromBackend('/repo-bad', { target: repo.repos[bad!] });
    infoFails.delete('/repo-bad');
    await repo.retryLoad();

    expect(repo.repos[bad!]!.loadError).toBeNull();
    expect(repo.loadError).toBeNull();
  });

  it('drops the failure of a repository closed while it was loading', async () => {
    const repo = useRepoStore();
    await repo.openRepo('/repo-ok');
    await repo.openRepo('/repo-bad');
    const [ok, bad] = repo.order;

    repo.activeId = ok!;
    infoFails.add('/repo-bad');
    const pending = repo.loadFromBackend('/repo-bad', {
      target: repo.repos[bad!]
    });
    // Closing the tab withdraws the request, so the failure has nowhere left to
    // be shown and is not promoted onto another tab or into the toast.
    repo.closeRepo(bad!);
    await pending;

    expect(repo.loadError).toBeNull();
    expect(repo.lastError).toBeNull();
  });
});
