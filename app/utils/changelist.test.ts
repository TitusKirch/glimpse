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
  CHANGELIST_SCHEMA_VERSION,
  DEFAULT_ID
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
