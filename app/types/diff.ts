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
  // Index into the source hunks array for hunk-header rows.
  hunkIndex?: number;
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
