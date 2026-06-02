import { describe, expect, it } from 'vitest';
import { moveToFront } from './recency';

const key = (s: string) => s;

describe('moveToFront', () => {
  it('inserts a new item at the front', () => {
    expect(moveToFront({ list: ['a', 'b'], item: 'c', key, max: 10 })).toEqual([
      'c',
      'a',
      'b'
    ]);
  });

  it('moves an existing item to the front without duplicating', () => {
    expect(
      moveToFront({ list: ['a', 'b', 'c'], item: 'b', key, max: 10 })
    ).toEqual(['b', 'a', 'c']);
  });

  it('caps the list to max, dropping the oldest', () => {
    expect(
      moveToFront({ list: ['a', 'b', 'c'], item: 'd', key, max: 3 })
    ).toEqual(['d', 'a', 'b']);
  });

  it('dedupes by key, not identity (newest payload wins)', () => {
    const list = [
      { id: 'x', n: 1 },
      { id: 'y', n: 2 }
    ];
    expect(
      moveToFront({ list, item: { id: 'x', n: 9 }, key: (e) => e.id, max: 5 })
    ).toEqual([
      { id: 'x', n: 9 },
      { id: 'y', n: 2 }
    ]);
  });

  it('keeps only the new item when max is 1', () => {
    expect(moveToFront({ list: ['a', 'b'], item: 'c', key, max: 1 })).toEqual([
      'c'
    ]);
  });

  it('returns an empty list when max is 0', () => {
    expect(moveToFront({ list: ['a'], item: 'b', key, max: 0 })).toEqual([]);
  });
});
