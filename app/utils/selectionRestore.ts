// What the diff panel should show after a repo reload (focus refresh, pull, …).
// A commit XOR a file XOR nothing — the same mutual exclusion the `selection`
// domain term names. Pure so the restore-or-default strategy is the test surface
// instead of being reachable only by running the whole loadFromBackend.
export type SelectionTarget =
  | { kind: 'commit'; hash: string }
  | { kind: 'file'; file: string; staged: boolean }
  | { kind: 'none' };

// Preserve the previous selection when it still exists in the freshly loaded
// repo; otherwise fall back to a default (first changed file, then newest
// commit, then nothing). `prevFile` only counts when no commit was selected —
// the two are mutually exclusive.
export function restoreSelection({
  prevHash,
  prevFile,
  prevFileStaged,
  commitHashes,
  statusPaths,
  defaultFile,
  defaultHash
}: {
  prevHash: string | null;
  prevFile: string | null;
  prevFileStaged: boolean;
  commitHashes: string[];
  statusPaths: string[];
  defaultFile: { file: string; staged: boolean } | null;
  defaultHash: string | null;
}): SelectionTarget {
  if (prevHash && commitHashes.includes(prevHash)) {
    return { kind: 'commit', hash: prevHash };
  }
  if (!prevHash && prevFile && statusPaths.includes(prevFile)) {
    return { kind: 'file', file: prevFile, staged: prevFileStaged };
  }
  if (defaultFile) {
    return { kind: 'file', file: defaultFile.file, staged: defaultFile.staged };
  }
  if (defaultHash) return { kind: 'commit', hash: defaultHash };
  return { kind: 'none' };
}
