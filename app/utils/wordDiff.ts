// Pure word-level diff of a removed/added line pair: trim the common prefix and
// suffix, returning the changed [start, end) range on each side. The diff
// viewer wraps these ranges to highlight intra-line edits. Extracted so it can
// be unit-tested without the component.

export interface WordDiffRanges {
  /** Length of the shared leading run (changed region starts here on both). */
  start: number;
  /** End (exclusive) of the changed region in the old string. */
  aEnd: number;
  /** End (exclusive) of the changed region in the new string. */
  bEnd: number;
}

export function wordDiffRanges(a: string, b: string): WordDiffRanges {
  let start = 0;
  const min = Math.min(a.length, b.length);
  while (start < min && a[start] === b[start]) start++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }
  return { start, aEnd, bEnd };
}
