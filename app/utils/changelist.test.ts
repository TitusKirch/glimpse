import { describe, expect, it } from 'vitest';
import {
  initialState,
  createList,
  deleteList,
  setActive,
  moveFile,
  listOf,
  reconcile,
  serialize,
  deserialize,
  hunkHash,
  moveHunk,
  listOfHunk,
  reconcileHunks,
  CHANGELIST_SCHEMA_VERSION,
  DEFAULT_ID,
  type ChangelistState
} from './changelist';

describe('changelist model', () => {
  it('starts with a single default list that is active', () => {
    const s = initialState();
    expect(s.lists).toHaveLength(1);
    expect(s.lists[0]!.id).toBe(DEFAULT_ID);
    expect(s.activeId).toBe(DEFAULT_ID);
  });

  it('moveFile enforces one path in exactly one list', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveFile(s, 'a.ts', featureId);
    s = moveFile(s, 'a.ts', DEFAULT_ID); // move again
    expect(listOf(s, 'a.ts')).toBe(DEFAULT_ID);
    expect(
      s.lists.flatMap((l) => l.members).filter((p) => p === 'a.ts')
    ).toEqual(['a.ts']);
  });

  it('deleteList moves members back to Default and never deletes Default', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveFile(s, 'a.ts', featureId);
    s = deleteList(s, featureId);
    expect(s.lists.map((l) => l.id)).toEqual([DEFAULT_ID]);
    expect(listOf(s, 'a.ts')).toBe(DEFAULT_ID);

    const before = JSON.stringify(s);
    s = deleteList(s, DEFAULT_ID); // refused
    expect(JSON.stringify(s)).toBe(before);
  });

  it('reconcile prunes vanished paths and routes new ones to the active list', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = setActive(s, featureId);
    s = moveFile(s, 'kept.ts', featureId);
    s = moveFile(s, 'gone.ts', DEFAULT_ID);

    s = reconcile(s, ['kept.ts', 'new.ts']); // gone.ts committed away, new.ts appeared
    expect(listOf(s, 'gone.ts')).toBeNull();
    expect(listOf(s, 'kept.ts')).toBe(featureId); // stable assignment
    expect(listOf(s, 'new.ts')).toBe(featureId); // routed to active
  });

  it('reconcile falls back to Default when the active list is gone', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = setActive(s, featureId);
    s = deleteList(s, featureId); // active resets to Default
    expect(s.activeId).toBe(DEFAULT_ID);
    s = reconcile(s, ['x.ts']);
    expect(listOf(s, 'x.ts')).toBe(DEFAULT_ID);
  });
});

describe('changelist persistence (on-disk contract)', () => {
  it('round-trips state through serialize/deserialize', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = setActive(s, featureId);
    s = moveFile(s, 'a.ts', featureId);
    const back = deserialize(serialize(s));
    expect(back).toEqual(s);
  });

  it('writes a versioned payload', () => {
    expect(JSON.parse(serialize(initialState())).version).toBe(
      CHANGELIST_SCHEMA_VERSION
    );
  });

  it('returns null for missing, corrupt or wrong-version JSON', () => {
    expect(deserialize(null)).toBeNull();
    expect(deserialize('')).toBeNull();
    expect(deserialize('{not json')).toBeNull();
    expect(
      deserialize(
        JSON.stringify({ version: 999, activeId: 'default', lists: [] })
      )
    ).toBeNull();
  });

  it('normalizes untrusted input: re-adds Default first, dedups paths, fixes activeId', () => {
    const s = deserialize(
      JSON.stringify({
        version: CHANGELIST_SCHEMA_VERSION,
        activeId: 'ghost',
        lists: [
          { id: 'feature', name: 'Feature', members: ['a.ts', 'b.ts'] },
          { id: 'other', name: 'Other', members: ['a.ts'] } // a.ts duplicated
        ]
      })
    );
    expect(s).not.toBeNull();
    expect(s!.lists[0]!.id).toBe(DEFAULT_ID); // Default re-added at front
    expect(s!.activeId).toBe(DEFAULT_ID); // unknown active id reset
    expect(listOf(s!, 'a.ts')).toBe('feature'); // first list keeps the dup
  });
});

// ── Hunk-level membership (#112) ──────────────────────────────────────────

// A realistic hunk: header with line numbers, an @@-trailing context caption,
// then body lines prefixed by ' ' / '-' / '+'.
const HUNK_A = '@@ -1,3 +1,4 @@ fn alpha()\n ctx\n-removed\n+added';
const HUNK_B = '@@ -20,2 +21,3 @@ fn beta()\n keep\n+beta line';

describe('hunk identity (context hash)', () => {
  it('ignores the line numbers, so an edit above a hunk does not change its id', () => {
    const moved = '@@ -80,3 +91,4 @@ fn alpha()\n ctx\n-removed\n+added';
    expect(hunkHash(moved)).toBe(hunkHash(HUNK_A));
  });

  it('covers the @@-trailing context caption, not only the body', () => {
    const otherCaption = '@@ -1,3 +1,4 @@ fn gamma()\n ctx\n-removed\n+added';
    expect(hunkHash(otherCaption)).not.toBe(hunkHash(HUNK_A));
  });

  it('separates hunks whose bodies differ', () => {
    expect(hunkHash(HUNK_B)).not.toBe(hunkHash(HUNK_A));
  });

  // The Rust port writes the same file this reads, so the two hashes have to
  // agree byte for byte. These pinned values are asserted in BOTH suites — if
  // either implementation drifts, one of the two goes red instead of the file
  // silently losing every assignment. The second case is the one that would
  // drift first: it only matches if both sides hash UTF-8 bytes.
  it('matches the Rust port on pinned vectors', () => {
    expect(hunkHash(HUNK_A)).toBe('c907e1087d29ad53');
    expect(hunkHash('@@ -1 +1 @@ grüßen\n+äöü')).toBe('4086f7e513f4fc64');
  });
});

describe('hunk membership', () => {
  it('keeps a hunk in exactly one list', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveHunk(s, 'a.ts', HUNK_A, featureId);
    s = moveHunk(s, 'a.ts', HUNK_A, DEFAULT_ID);
    expect(listOfHunk(s, 'a.ts', hunkHash(HUNK_A))).toBe(DEFAULT_ID);
    expect(
      s.lists.flatMap((l) => l.hunks ?? []).filter((h) => h.path === 'a.ts')
    ).toHaveLength(1);
  });

  it('lets one path span several lists when its hunks are disjoint', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveHunk(s, 'a.ts', HUNK_A, featureId);
    s = moveHunk(s, 'a.ts', HUNK_B, DEFAULT_ID);
    expect(listOfHunk(s, 'a.ts', hunkHash(HUNK_A))).toBe(featureId);
    expect(listOfHunk(s, 'a.ts', hunkHash(HUNK_B))).toBe(DEFAULT_ID);
  });

  it('files a split path under the list holding most of its hunks', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    const third = '@@ -40,1 +40,2 @@\n x\n+third';
    s = moveHunk(s, 'a.ts', HUNK_A, featureId);
    s = moveHunk(s, 'a.ts', third, featureId);
    s = moveHunk(s, 'a.ts', HUNK_B, DEFAULT_ID);
    expect(listOf(s, 'a.ts')).toBe(featureId); // 2 hunks vs 1
  });

  it('breaks a tie on hunk count by list order', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveHunk(s, 'a.ts', HUNK_A, DEFAULT_ID);
    s = moveHunk(s, 'a.ts', HUNK_B, featureId);
    expect(listOf(s, 'a.ts')).toBe(DEFAULT_ID); // Default comes first
  });

  it('returns a deleted list’s hunks to Default rather than dropping them', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveHunk(s, 'a.ts', HUNK_A, featureId);
    s = deleteList(s, featureId);
    expect(listOfHunk(s, 'a.ts', hunkHash(HUNK_A))).toBe(DEFAULT_ID);
  });
});

describe('hunk reconcile (drift resolution)', () => {
  it('stage 1: an unchanged hunk keeps its list by exact hash', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveHunk(s, 'a.ts', HUNK_A, featureId);
    const out = reconcileHunks(s, [{ path: 'a.ts', hunks: [HUNK_A] }]);
    expect(listOfHunk(out.state, 'a.ts', hunkHash(HUNK_A))).toBe(featureId);
    expect(out.drifted).toEqual([]);
  });

  it('stage 2: a hunk whose context shifted is matched on its +/- line overlap', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveHunk(s, 'a.ts', HUNK_A, featureId);
    // Same edit, but the surrounding context line changed → different hash.
    const shifted =
      '@@ -1,4 +1,5 @@ fn alpha()\n ctx\n other\n-removed\n+added';
    expect(hunkHash(shifted)).not.toBe(hunkHash(HUNK_A));
    const out = reconcileHunks(s, [{ path: 'a.ts', hunks: [shifted] }]);
    expect(listOfHunk(out.state, 'a.ts', hunkHash(shifted))).toBe(featureId);
    expect(out.drifted).toEqual([]);
  });

  it('stage 3: an unresolvable hunk lands in the active list and is never put in a list it was not in', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    ({ state: s } = createList(s, 'Other'));
    const otherId = s.lists[2]!.id;
    s = setActive(s, otherId);
    s = moveHunk(s, 'a.ts', HUNK_A, featureId);

    const unrelated = '@@ -99,1 +99,2 @@ fn zeta()\n q\n+totally different';
    const out = reconcileHunks(s, [{ path: 'a.ts', hunks: [unrelated] }]);
    expect(listOfHunk(out.state, 'a.ts', hunkHash(unrelated))).toBe(otherId); // the ACTIVE list
    expect(listOfHunk(out.state, 'a.ts', hunkHash(unrelated))).not.toBe(
      featureId
    );
    expect(out.drifted).toEqual(['a.ts']); // surfaced, never silent
  });

  it('drops hunks that are no longer present in the diff', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveHunk(s, 'a.ts', HUNK_A, featureId);
    const out = reconcileHunks(s, []); // file committed away
    expect(listOfHunk(out.state, 'a.ts', hunkHash(HUNK_A))).toBeNull();
  });
});

describe('hunk persistence (additive, still version 1)', () => {
  it('keeps the schema version so an older build can still read the file', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    s = moveHunk(s, 'a.ts', HUNK_A, s.lists[1]!.id);
    expect(JSON.parse(serialize(s)).version).toBe(CHANGELIST_SCHEMA_VERSION);
  });

  it('round-trips hunk membership', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    s = moveHunk(s, 'a.ts', HUNK_A, s.lists[1]!.id);
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('still reads a file written before hunks existed', () => {
    const s = deserialize(
      JSON.stringify({
        version: CHANGELIST_SCHEMA_VERSION,
        activeId: DEFAULT_ID,
        lists: [{ id: DEFAULT_ID, name: 'Default', members: ['a.ts'] }]
      })
    );
    expect(s).not.toBeNull();
    expect(listOf(s!, 'a.ts')).toBe(DEFAULT_ID);
  });

  it('an older build still sees the split path at file level', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveHunk(s, 'a.ts', HUNK_A, featureId);
    s = moveHunk(s, 'a.ts', HUNK_B, featureId);
    s = moveHunk(s, 'a.ts', '@@ -9,1 +9,2 @@\n z\n+c', DEFAULT_ID);
    const onDisk = JSON.parse(serialize(s));
    const withPath = onDisk.lists.filter((l: { members: string[] }) =>
      l.members.includes('a.ts')
    );
    expect(withPath).toHaveLength(1); // exactly one list claims it file-level
    expect(withPath[0].id).toBe(featureId); // the majority holder
  });

  it('normalizes untrusted input so a hunk cannot sit in two lists', () => {
    const s = deserialize(
      JSON.stringify({
        version: CHANGELIST_SCHEMA_VERSION,
        activeId: DEFAULT_ID,
        lists: [
          {
            id: DEFAULT_ID,
            name: 'Default',
            members: [],
            hunks: [{ path: 'a.ts', hash: 'deadbeef' }]
          },
          {
            id: 'feature',
            name: 'Feature',
            members: [],
            hunks: [{ path: 'a.ts', hash: 'deadbeef' }]
          }
        ]
      })
    );
    expect(s).not.toBeNull();
    expect(listOfHunk(s!, 'a.ts', 'deadbeef')).toBe(DEFAULT_ID); // first wins
    expect(s!.lists.flatMap((l) => l.hunks ?? [])).toHaveLength(1);
  });
});

// ── Review round 1 (#112) ─────────────────────────────────────────────────

describe('file-level and hunk-level gestures together', () => {
  it('moveFile survives a round-trip once the path carries hunks', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveHunk(s, 'a.ts', HUNK_A, featureId);

    // The file-level gesture asserts itself over the sub-file one...
    s = moveFile(s, 'a.ts', DEFAULT_ID);
    expect(listOf(s, 'a.ts')).toBe(DEFAULT_ID);
    expect(listOfHunk(s, 'a.ts', hunkHash(HUNK_A))).toBe(DEFAULT_ID);

    // ...and the result is a fixed point of normalize, so nothing recomputes
    // `members` back out from a hunk left behind in the old list.
    expect(listOf(deserialize(serialize(s))!, 'a.ts')).toBe(DEFAULT_ID);
  });

  it('moveFile takes every hunk of the path, not just one', () => {
    let s = initialState();
    ({ state: s } = createList(s, 'Feature'));
    const featureId = s.lists[1]!.id;
    s = moveHunk(s, 'a.ts', HUNK_A, featureId);
    s = moveHunk(s, 'a.ts', HUNK_B, DEFAULT_ID);
    s = moveFile(s, 'a.ts', featureId);
    expect(listOfHunk(s, 'a.ts', hunkHash(HUNK_B))).toBe(featureId);
    expect(listOf(deserialize(serialize(s))!, 'a.ts')).toBe(featureId);
  });
});

describe('state rehydrated from a cache written before hunks existed', () => {
  // The Pinia store is `persist: true`, so `byRepo` comes back out of
  // localStorage as raw JSON without passing through `deserialize` — the zod
  // schema guards the FILE, not this path. Such a state has no `hunks` at all.
  const legacy = () =>
    JSON.parse(
      JSON.stringify({
        activeId: DEFAULT_ID,
        lists: [{ id: DEFAULT_ID, name: 'Default', members: ['a.ts'] }]
      })
    ) as ChangelistState;

  it('does not throw anywhere the store can reach it', () => {
    expect(() => createList(legacy(), 'X')).not.toThrow();
    expect(() => serialize(legacy())).not.toThrow();
    expect(() => reconcile(legacy(), ['a.ts'])).not.toThrow();
    expect(() => moveFile(legacy(), 'a.ts', DEFAULT_ID)).not.toThrow();
    expect(() => deleteList(legacy(), DEFAULT_ID)).not.toThrow();
    expect(() => listOfHunk(legacy(), 'a.ts', 'deadbeef')).not.toThrow();
  });

  it('keeps the cached file-level membership through a seeding round-trip', () => {
    // `load()` migrates cached membership into the file when none exists yet:
    // persistNow -> serialize -> deserialize.
    const seeded = deserialize(serialize(legacy()));
    expect(seeded).not.toBeNull();
    expect(listOf(seeded!, 'a.ts')).toBe(DEFAULT_ID);
  });
});
