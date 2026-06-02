import { describe, expect, it } from 'vitest';
import { useSearch } from './useSearch';

const { fuzzySearch } = useSearch();

describe('fuzzySearch', () => {
  it('returns every item in original order for an empty query', () => {
    const items = ['fetch', 'pull', 'push'];
    const hits = fuzzySearch(items, '');
    expect(hits.map((h) => h.item)).toEqual(items);
    expect(hits.every((h) => h.score === 1)).toBe(true);
  });

  it('matches a plain string array', () => {
    const hits = fuzzySearch(['fetch', 'pull', 'push'], 'pul');
    expect(hits[0]?.item).toBe('pull');
  });

  it('tolerates typos / non-contiguous characters', () => {
    // "fpush" is not a substring of "force push" but should still fuzzy-match.
    const hits = fuzzySearch(['force push', 'fetch', 'pull'], 'fpush');
    expect(hits.map((h) => h.item)).toContain('force push');
  });

  it('searches the given object keys', () => {
    const items = [
      { id: 'a', value: 'Switch branch' },
      { id: 'b', value: 'Delete branch' }
    ];
    const hits = fuzzySearch(items, 'delete', { keys: ['value'] });
    expect(hits[0]?.item.id).toBe('b');
  });

  it('scores matches above zero so callers can treat >0 as visible', () => {
    const hits = fuzzySearch(['fetch', 'pull'], 'fetch');
    expect(hits.every((h) => h.score > 0)).toBe(true);
  });
});
