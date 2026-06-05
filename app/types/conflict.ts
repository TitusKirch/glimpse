// Segments a conflicted file parses into (see composables/parseConflicts): plain
// runs of text and conflict regions with their ours / theirs (and, in diff3
// style, base) sides.

export interface PlainSegment {
  type: 'text';
  text: string;
}

export interface ConflictSegment {
  type: 'conflict';
  ours: string;
  theirs: string;
  // Present only when the file uses the diff3 conflict style.
  base?: string;
}

export type MergeSegment = PlainSegment | ConflictSegment;
