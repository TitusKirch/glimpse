// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, defineStore, setActivePinia } from 'pinia';

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

const { useRepoStore } = await import('./repo');

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
