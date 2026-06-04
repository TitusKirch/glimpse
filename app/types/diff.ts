// Row models the diff renderer binds (see composables/parseDiff). Kept out of the
// parser so that file holds a single same-named export.

export type RowType = 'hunk' | 'context' | 'add' | 'del';

// One line of the unified (single-column) view.
export interface UnifiedRow {
  type: RowType;
  oldNo?: number;
  newNo?: number;
  html: string;
  // Raw line text (for word-level diffing); undefined for hunk headers.
  text?: string;
  // Index into the source hunks array — set on the hunk header *and* every body
  // row, so line selection knows which hunk a selected line belongs to.
  hunkIndex?: number;
  // 0-based position of this line within its hunk body (context/add/remove all
  // count; the `@@` header and `\ No newline` marker do not). Drives line-level
  // staging — the backend `apply_lines` indexes the hunk body the same way.
  lineIndex?: number;
}

export type CellType = 'context' | 'add' | 'del' | 'empty';

// One side of a split (side-by-side) row.
export interface SplitCell {
  no?: number;
  html: string;
  type: CellType;
}

export interface SplitRow {
  hunk?: string;
  hunkIndex?: number;
  left?: SplitCell;
  right?: SplitCell;
}

export interface ParsedDiff {
  unified: UnifiedRow[];
  split: SplitRow[];
}
