// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { initialState, serialize } from '../utils/changelist';

// Closing a tab is driven through the real repo store, so its demo seed needs
// the same Nuxt auto-imports repo.spec.ts stubs. The browser shell is the one
// where `closeRepo` reaches neither the FS watcher nor the session store, which
// keeps these tests about the changelist bookkeeping and nothing else.
const isTauriProbe = vi.fn(() => false);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: isTauriProbe
}));

const readChangelists = vi.fn<(path: string) => Promise<string | null>>();
const writeChangelists =
  vi.fn<(arg: { path: string; json: string }) => Promise<null>>();

const g = globalThis as Record<string, unknown>;
const { isTauri } = await import('../composables/isTauri');
const { gitMock } = await import('../composables/gitMock');
g.defineStore = defineStore;
g.isTauri = isTauri;
g.gitMock = gitMock;
g.gitClient = { readChangelists, writeChangelists };

const { useChangelistsStore } = await import('./changelists');
g.useChangelistsStore = useChangelistsStore;
const { useRepoStore } = await import('./repo');

const TOP = '/repos/alpha';
const OTHER = '/repos/beta';

// The debounce window in the store, plus a margin.
const PAST_DEBOUNCE = 500;

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  vi.useFakeTimers();
  readChangelists.mockReset().mockResolvedValue(null);
  writeChangelists.mockReset().mockResolvedValue(null);
  isTauriProbe.mockReset().mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('changelists store release() (regression for #186)', () => {
  it('drops the persisted membership for the released repo only', async () => {
    const store = useChangelistsStore();
    store.createList(TOP, 'Docs');
    store.createList(OTHER, 'Docs');

    await store.release(TOP);

    expect(store.byRepo[TOP]).toBeUndefined();
    expect(Object.keys(store.byRepo)).toEqual([OTHER]);
  });

  it('forgets the load dedup, so a reopened repo reads the file again', async () => {
    const store = useChangelistsStore();
    await store.load(TOP);
    await store.load(TOP);
    expect(readChangelists).toHaveBeenCalledTimes(1);

    await store.release(TOP);
    await store.load(TOP);

    expect(readChangelists).toHaveBeenCalledTimes(2);
  });

  it('forgets the last-written snapshot, the costly entry per repo', async () => {
    const onDisk = serialize(initialState());
    readChangelists.mockResolvedValue(onDisk);
    const store = useChangelistsStore();
    await store.load(TOP);

    await store.release(TOP);

    // With the snapshot gone, a state identical to what was on disk is no
    // longer recognised as "already written" and schedules a real write.
    store.ensure(TOP);
    store.schedulePersist(TOP);
    await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE);
    expect(writeChangelists).toHaveBeenCalledWith({ path: TOP, json: onDisk });
  });

  it('leaves another repo’s load dedup and state untouched', async () => {
    const store = useChangelistsStore();
    await store.load(TOP);
    await store.load(OTHER);
    store.createList(OTHER, 'Docs');

    await store.release(TOP);

    await store.load(OTHER);
    expect(readChangelists).toHaveBeenCalledTimes(2);
    expect(store.byRepo[OTHER]?.lists).toHaveLength(2);
  });

  it('flushes a pending debounced write instead of losing the edit', async () => {
    const store = useChangelistsStore();
    await store.load(TOP);
    store.createList(TOP, 'Docs');
    expect(writeChangelists).not.toHaveBeenCalled();

    await store.release(TOP);

    expect(writeChangelists).toHaveBeenCalledTimes(1);
    const { json } = writeChangelists.mock.calls[0]![0];
    expect(JSON.parse(json).lists.map((l: { name: string }) => l.name)).toEqual(
      ['Default', 'Docs']
    );
  });

  it('cancels the debounce timer, so no write fires against released state', async () => {
    const store = useChangelistsStore();
    await store.load(TOP);
    store.createList(TOP, 'Docs');

    await store.release(TOP);
    await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE);

    expect(writeChangelists).toHaveBeenCalledTimes(1);
    expect(store.byRepo[TOP]).toBeUndefined();
  });

  it('writes nothing when the repo has no unsaved edits', async () => {
    readChangelists.mockResolvedValue(serialize(initialState()));
    const store = useChangelistsStore();
    await store.load(TOP);

    await store.release(TOP);

    expect(writeChangelists).not.toHaveBeenCalled();
  });

  it('ignores a placeholder toplevel, which is never a real repo', async () => {
    const store = useChangelistsStore();
    await store.release('.');
    expect(writeChangelists).not.toHaveBeenCalled();
  });
});

describe('changelists store release() vs. an in-flight read (#186)', () => {
  // A read that lands after the tab closed would put the repo straight back
  // into the maps release just emptied, and nothing would ever clear it again.
  const pendingRead = () => {
    let settle: (json: string | null) => void = () => {};
    readChangelists.mockReturnValue(
      new Promise<string | null>((resolve) => {
        settle = resolve;
      })
    );
    return (json: string | null) => settle(json);
  };

  it('does not let a load resolving after release restore the repo', async () => {
    const settle = pendingRead();
    const store = useChangelistsStore();
    const inFlight = store.load(TOP);

    await store.release(TOP);
    settle(serialize(initialState()));
    await inFlight;

    expect(store.byRepo[TOP]).toBeUndefined();
  });

  it('does not let a reload resolving after release restore the repo', async () => {
    const settle = pendingRead();
    const store = useChangelistsStore();
    const inFlight = store.reload(TOP);

    await store.release(TOP);
    settle(serialize(initialState()));
    await inFlight;

    expect(store.byRepo[TOP]).toBeUndefined();
  });

  it('does not let a sync resolving after release restore the repo', async () => {
    const settle = pendingRead();
    const store = useChangelistsStore();
    const inFlight = store.sync(TOP, ['a.txt']);

    await store.release(TOP);
    settle(null);
    await inFlight;

    expect(store.byRepo[TOP]).toBeUndefined();
    expect(writeChangelists).not.toHaveBeenCalled();
  });

  // Review round 1: `persistNow` is the fourth writer into `lastWritten`, and
  // it writes AFTER its await. The debounce fires it and forgets it, so a tab
  // closed while that write is in flight left the entry re-created for a repo
  // with no tab — the costliest entry, and the one nothing would remove again.
  it('does not let a write resolving after release restore the snapshot', async () => {
    let settle: () => void = () => {};
    writeChangelists.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        settle = resolve;
      })
    );
    const store = useChangelistsStore();
    store.byRepo[TOP] = initialState();
    const inFlight = store.persistNow(TOP);

    await store.release(TOP);
    settle();
    await inFlight;

    // The snapshot is what proves it: if `lastWritten` came back, the store
    // believes that JSON is on disk and a fresh save of the same content is
    // skipped as a no-op. So ask for exactly that and require a write.
    writeChangelists.mockClear();
    store.byRepo[TOP] = initialState();
    store.schedulePersist(TOP);
    await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE);
    expect(writeChangelists).toHaveBeenCalled();
  });
});

describe('closeRepo releases changelist bookkeeping (#186)', () => {
  it('releases the closed tab’s repo', async () => {
    const repo = useRepoStore();
    const path = repo.repos.r1!.path;
    const store = useChangelistsStore();
    store.createList(path, 'Docs');

    repo.closeRepo('r1');
    await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE);

    expect(store.byRepo[path]).toBeUndefined();
    // The pending edit still reached the file rather than dying with the tab.
    expect(writeChangelists).toHaveBeenCalledTimes(1);
  });

  it('keeps the state while another tab still shows the same repo', () => {
    const repo = useRepoStore();
    const path = repo.repos.r1!.path;
    repo.repos.r2 = { ...repo.repos.r1!, id: 'r2' };
    repo.order.push('r2');
    const store = useChangelistsStore();
    store.createList(path, 'Docs');

    repo.closeRepo('r1');

    expect(store.byRepo[path]?.lists).toHaveLength(2);
  });

  it('is a no-op for an unknown tab id', () => {
    const repo = useRepoStore();
    const path = repo.repos.r1!.path;
    const store = useChangelistsStore();
    store.createList(path, 'Docs');

    repo.closeRepo('nope');

    expect(store.byRepo[path]?.lists).toHaveLength(2);
  });
});
