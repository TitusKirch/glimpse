import { describe, expect, it } from 'vitest';
import {
  initialState,
  createList,
  deleteList,
  setActive,
  moveFile,
  listOf,
  reconcile,
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
