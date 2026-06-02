// Shared fuzzy search (Fuse.js) so every search in the app — the command
// palette, the language comboboxes, anything future — feels the same and is
// configured in one place. useSearch() exposes two helpers:
//   - fuzzySearch(): a pure function, for callers that manage their own state
//     (e.g. the Command component maps hits to per-item scores).
//   - search(): a reactive wrapper returning the filtered+ranked list.

import type { IFuseOptions } from 'fuse.js';
import type { MaybeRefOrGetter } from 'vue';
import Fuse from 'fuse.js';
import { computed, toValue } from 'vue';

// App-wide defaults: match anywhere in the string (not just the start) with a
// middling typo tolerance. Tune here to change every search at once.
const BASE_OPTIONS = {
  ignoreLocation: true,
  threshold: 0.4,
  includeScore: true
} satisfies IFuseOptions<unknown>;

interface SearchHit<T> {
  item: T;
  // Normalised 0..1, higher = better (1 for an empty query or a perfect match).
  score: number;
}

interface SearchOptions<T> {
  // Object keys to search. Omit when searching an array of plain strings.
  keys?: IFuseOptions<T>['keys'];
  // Typo tolerance: 0 (exact) .. 1 (match anything). Defaults to the app-wide 0.4.
  threshold?: number;
}

export function useSearch() {
  function makeFuse<T>(items: readonly T[], options: SearchOptions<T>) {
    const fuseOptions: IFuseOptions<T> = {
      ...BASE_OPTIONS,
      threshold: options.threshold ?? BASE_OPTIONS.threshold
    };
    // Fuse's KeyStore throws on `keys: undefined`; only set it for object items.
    if (options.keys) fuseOptions.keys = options.keys;
    return new Fuse(items as T[], fuseOptions);
  }

  // Pure, framework-agnostic fuzzy filter. An empty query returns every item in
  // its original order; otherwise Fuse ranks by best match.
  function fuzzySearch<T>(
    items: readonly T[],
    query: string,
    options: SearchOptions<T> = {}
  ): SearchHit<T>[] {
    if (!query) return items.map((item) => ({ item, score: 1 }));
    return makeFuse(items, options)
      .search(query)
      .map(({ item, score }) => ({
        item,
        score: score === undefined ? 1 : 1 - score
      }));
  }

  // Reactive wrapper: pass a ref/getter source list and query, get the
  // filtered, ranked list back. The Fuse index is rebuilt only when the source
  // changes, not on every keystroke.
  function search<T>(
    source: MaybeRefOrGetter<readonly T[]>,
    query: MaybeRefOrGetter<string>,
    options: SearchOptions<T> = {}
  ) {
    const fuse = computed(() => makeFuse(toValue(source), options));
    return computed<T[]>(() => {
      const q = toValue(query);
      if (!q) return [...toValue(source)];
      return fuse.value.search(q).map((r) => r.item);
    });
  }

  return { fuzzySearch, search };
}
