// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import type { RepoInfo } from '~/types/bindings';
import type { RepoState } from './repo';

// The demo repo carries a fictional \\wsl$ path. In the browser that is the
// point — it is what makes the UI developable with no backend. In the desktop
// shell the same seed put a fictional path in `active.path` during boot, where
// useConventionalCommits runs real git against it; since the global error
// plugin that rejection is fatal, so the start screen became a crash page.
// These tests pin which shell gets the seed.
const isTauriProbe = vi.fn(() => false);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: isTauriProbe
}));

const g = globalThis as Record<string, unknown>;
const { isTauri } = await import('../composables/isTauri');
const { gitMock } = await import('../composables/gitMock');
// All three are Nuxt auto-imports (free globals) where the store runs for real.
// gitMock is only reachable through demoRepo(), so the desktop cases below pass
// without it — which is itself the fix these tests pin.
g.defineStore = defineStore;
g.isTauri = isTauri;
g.gitMock = gitMock;

// The store also reaches the backend client and the session store through
// auto-imports. `info` hands back a promise the test settles by hand, because
// the bookkeeping under test only exists while a probe is still in flight.
const infoProbes: {
  resolve: (info: RepoInfo) => void;
  reject: (err: unknown) => void;
}[] = [];
const info = vi.fn(
  () =>
    new Promise<RepoInfo>((resolve, reject) => {
      infoProbes.push({ resolve, reject });
    })
);
g.gitClient = { info, watchRepo: vi.fn() };
const { cleanGitError } = await import('../composables/cleanGitError');
g.cleanGitError = cleanGitError;
const { useSessionStore } = await import('./session');
g.useSessionStore = useSessionStore;
// `closeRepo` releases the closed repo's changelist state (#186); these specs
// are about the store's own bookkeeping, so it only has to exist for that call.
g.useChangelistsStore = () => ({ release: () => Promise.resolve() });

const { isResolvingPlatform, useRepoStore } = await import('./repo');

beforeEach(() => {
  setActivePinia(createPinia());
  isTauriProbe.mockReset();
});

describe('repo store initial state', () => {
  it('seeds the demo repo in the browser, where nothing runs git', () => {
    isTauriProbe.mockReturnValue(false);
    const repo = useRepoStore();
    expect(repo.order).toEqual(['r1']);
    expect(repo.activeId).toBe('r1');
    expect(repo.repos.r1?.path).toContain('wsl$');
  });

  it('starts the desktop shell empty, so boot has no path to run git against', () => {
    isTauriProbe.mockReturnValue(true);
    const repo = useRepoStore();
    expect(repo.order).toEqual([]);
    expect(repo.repos).toEqual({});
    expect(repo.activeId).toBe('');
    // What useConventionalCommits reads before restoreSession() has run.
    expect(repo.active?.path ?? '').toBe('');
  });

  it('leaves the desktop id counter clear of the seed it never made', () => {
    isTauriProbe.mockReturnValue(true);
    expect(useRepoStore().seq).toBe(0);
  });
});

const WSL_TOP = '\\\\wsl$\\Ubuntu\\home\\dev\\glimpse';

// `blankRepo()` is module-private, so placeholder tabs are hand-built here.
function wslTab(id: string, overrides: Partial<RepoState> = {}): RepoState {
  return {
    id,
    name: id,
    path: `${WSL_TOP}-${id}`,
    flavor: 'wsl',
    distro: undefined,
    branches: [],
    remoteBranches: [],
    currentBranch: '',
    remotes: [],
    tags: [],
    stashes: [],
    commits: [],
    status: [],
    selectedHash: null,
    selectedBody: '',
    selectedFile: null,
    selectedFileStaged: false,
    commitFiles: [],
    diff: null,
    loaded: false,
    resolving: true,
    rebaseInProgress: false,
    bisectInProgress: false,
    ...overrides
  };
}

function repoInfo(toplevel: string): RepoInfo {
  return {
    toplevel,
    currentBranch: 'main',
    branches: [],
    remoteBranches: [],
    remotes: [],
    tags: [],
    stashes: [],
    rebaseInProgress: false,
    bisectInProgress: false,
    flavor: 'wsl',
    distro: 'Ubuntu'
  };
}

// Let the microtask queue drain so an awaited probe's continuation runs.
const flush = () => new Promise((r) => setTimeout(r, 0));

// The set of tabs whose platform is being probed is bookkeeping with no other
// visible symptom: an id left in it claims a probe for a tab that is gone, and
// tab ids never repeat, so nothing would clear it for the rest of the session.
describe('platform probe bookkeeping', () => {
  beforeEach(() => {
    infoProbes.length = 0;
    info.mockClear();
    isTauriProbe.mockReturnValue(true);
  });

  it('holds a tab id for as long as its probe is really in flight', async () => {
    const repo = useRepoStore();
    const tab = wslTab('r1');
    repo.repos.r1 = tab;
    repo.order = ['r1'];
    repo.activeId = 'r1';

    void repo.resolveTabPlatforms();
    expect(isResolvingPlatform('r1')).toBe(true);

    infoProbes[0]!.resolve(repoInfo(tab.path));
    await flush();

    expect(isResolvingPlatform('r1')).toBe(false);
    expect(repo.repos.r1?.distro).toBe('Ubuntu');
    expect(repo.repos.r1?.resolving).toBe(false);
  });

  // Each case below uses its own tab id: the set outlives any one store, so a
  // leak would otherwise decide the next test's outcome.
  it('releases a tab closed mid-probe, without waiting for the probe to land', async () => {
    const repo = useRepoStore();
    repo.repos.r2 = wslTab('r2');
    repo.order = ['r2'];
    repo.activeId = 'r2';

    void repo.resolveTabPlatforms();
    expect(isResolvingPlatform('r2')).toBe(true);

    repo.closeRepo('r2');
    expect(isResolvingPlatform('r2')).toBe(false);

    // The abandoned probe still lands; it must not revive the claim either.
    infoProbes[0]!.resolve(repoInfo(WSL_TOP));
    await flush();
    expect(isResolvingPlatform('r2')).toBe(false);
  });

  it('releases the provisional tab doOpenRepo drops after a failed probe', async () => {
    const repo = useRepoStore();
    repo.seq = 4;

    const open = repo.doOpenRepo(WSL_TOP);
    // A background sweep claims the provisional tab while the open is still
    // in flight — the window in which the open then closes that tab.
    void repo.resolveTabPlatforms();
    expect(isResolvingPlatform('r5')).toBe(true);

    infoProbes[0]!.reject('fatal: not a git repository');
    await open;

    expect(repo.repos.r5).toBeUndefined();
    expect(isResolvingPlatform('r5')).toBe(false);
  });

  it('releases the provisional tab doOpenRepo drops as a duplicate', async () => {
    const repo = useRepoStore();
    repo.repos.r6 = wslTab('r6', {
      path: WSL_TOP,
      loaded: true,
      resolving: false
    });
    repo.order = ['r6'];
    repo.activeId = 'r6';
    repo.seq = 6;

    const open = repo.doOpenRepo(`${WSL_TOP}\\app`);
    void repo.resolveTabPlatforms();
    expect(isResolvingPlatform('r7')).toBe(true);

    // The probe reports the subdirectory's toplevel: the same repo as r6.
    infoProbes[0]!.resolve(repoInfo(WSL_TOP));
    await open;

    expect(repo.repos.r7).toBeUndefined();
    expect(repo.activeId).toBe('r6');
    expect(isResolvingPlatform('r7')).toBe(false);
  });

  it('releases the id when the probe itself fails', async () => {
    const repo = useRepoStore();
    repo.repos.r3 = wslTab('r3');
    repo.order = ['r3'];
    repo.activeId = 'r3';

    void repo.resolveTabPlatforms();
    infoProbes[0]!.reject('probe failed');
    await flush();

    expect(isResolvingPlatform('r3')).toBe(false);
    expect(repo.repos.r3?.resolving).toBe(false);
  });
});
