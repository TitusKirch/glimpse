// The repo store's per-tab state and the pure helpers around it.
//
// These were unreachable while they sat inside `repo.ts` beside the store: a
// test could only observe `blankRepo` through a tab that had been opened, which
// means through Tauri, Pinia and a mocked git client. Extracted, they are what
// they always were — plain functions over a path string — and the placeholder
// state a restored tab starts in is worth pinning directly, because every tab
// the session restores is built from it.
import { describe, expect, it } from 'vitest';

const g = globalThis as Record<string, unknown>;
g.gitMock = { commits: [], status: [], diff: null };

const { blankRepo, demoRepo, isStashRef, mainlineSchema, nextActivation } =
  await import('./state');

describe('blankRepo', () => {
  it('names the tab after the last path segment', () => {
    expect(blankRepo({ id: 'r1', path: '/home/titus/glimpse' }).name).toBe(
      'glimpse'
    );
    expect(blankRepo({ id: 'r1', path: 'C:\\dev\\glimpse' }).name).toBe(
      'glimpse'
    );
  });

  it('falls back to a generic name when the path has no segment', () => {
    expect(blankRepo({ id: 'r1', path: '/' }).name).toBe('repo');
  });

  it('guesses WSL from a \\\\wsl$ path and spins its icon until probed', () => {
    const r = blankRepo({ id: 'r1', path: '\\\\wsl$\\Ubuntu\\home\\t\\p' });
    expect(r.flavor).toBe('wsl');
    expect(r.resolving).toBe(true);
  });

  it('accepts the \\\\wsl.localhost spelling and forward slashes too', () => {
    expect(
      blankRepo({ id: 'r1', path: '//wsl.localhost/Ubuntu/p' }).flavor
    ).toBe('wsl');
  });

  it('treats anything else as native, with no icon spinner', () => {
    const r = blankRepo({ id: 'r1', path: '/home/titus/glimpse' });
    expect(r.flavor).toBe('linux');
    expect(r.resolving).toBe(false);
  });

  it('starts unloaded and empty, so first activation fetches', () => {
    const r = blankRepo({ id: 'r1', path: '/home/titus/glimpse' });
    expect(r.loaded).toBe(false);
    expect(r.commits).toEqual([]);
    expect(r.status).toEqual([]);
    expect(r.selectedHash).toBeNull();
    expect(r.diff).toBeNull();
    expect(r.loadError).toBeNull();
  });
});

describe('demoRepo', () => {
  it('is loaded on arrival — the browser demo never fetches', () => {
    expect(demoRepo().loaded).toBe(true);
  });

  it('carries one unpublished branch, which is what the sidebar marker needs', () => {
    expect(demoRepo().branches.filter((b) => !b.published)).toHaveLength(1);
  });
});

describe('nextActivation', () => {
  it('rises on every call, so no two tabs can tie for least-recently-used', () => {
    const a = nextActivation();
    const b = nextActivation();
    expect(b).toBeGreaterThan(a);
  });
});

describe('isStashRef', () => {
  it('recognises the stash@{N} form git prints', () => {
    expect(isStashRef('stash@{0}')).toBe(true);
    expect(isStashRef('stash@{12}')).toBe(true);
  });

  it('rejects a commit hash and a branch that merely mentions stash', () => {
    expect(isStashRef('a1b2c3d')).toBe(false);
    expect(isStashRef('feat/stash@{0}')).toBe(false);
  });
});

describe('mainlineSchema', () => {
  it('accepts a 1-based parent inside the commit\u2019s parent count', () => {
    const schema = mainlineSchema(2);
    expect(schema.safeParse('1').success).toBe(true);
    expect(schema.safeParse('2').success).toBe(true);
  });

  it('rejects zero, an over-count, and anything not a whole number', () => {
    const schema = mainlineSchema(2);
    expect(schema.safeParse('0').success).toBe(false);
    expect(schema.safeParse('3').success).toBe(false);
    expect(schema.safeParse('1.5').success).toBe(false);
    expect(schema.safeParse('two').success).toBe(false);
    expect(schema.safeParse('').success).toBe(false);
  });
});
