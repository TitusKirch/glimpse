import { describe, expect, it } from 'vitest';
import { restoreSelection } from './selectionRestore';

const base = {
  prevHash: null,
  prevFile: null,
  prevFileStaged: false,
  commitHashes: [] as string[],
  statusPaths: [] as string[],
  defaultFile: null,
  defaultHash: null
};

describe('restoreSelection', () => {
  it('keeps the selected commit when it is still in the log', () => {
    expect(
      restoreSelection({
        ...base,
        prevHash: 'abc',
        commitHashes: ['abc', 'def']
      })
    ).toEqual({ kind: 'commit', hash: 'abc' });
  });

  it('keeps the selected file when no commit was selected and it still exists', () => {
    expect(
      restoreSelection({
        ...base,
        prevFile: 'a.ts',
        prevFileStaged: true,
        statusPaths: ['a.ts']
      })
    ).toEqual({ kind: 'file', file: 'a.ts', staged: true });
  });

  it('does not restore a file when a commit was selected (mutual exclusion)', () => {
    expect(
      restoreSelection({
        ...base,
        prevHash: 'gone',
        prevFile: 'a.ts',
        statusPaths: ['a.ts'],
        defaultHash: 'newest'
      })
    ).toEqual({ kind: 'commit', hash: 'newest' });
  });

  it('falls back to the default file when the previous selection is gone', () => {
    expect(
      restoreSelection({
        ...base,
        prevHash: 'gone',
        defaultFile: { file: 'b.ts', staged: false },
        defaultHash: 'h'
      })
    ).toEqual({ kind: 'file', file: 'b.ts', staged: false });
  });

  it('falls back to the newest commit when there is no default file', () => {
    expect(restoreSelection({ ...base, defaultHash: 'newest' })).toEqual({
      kind: 'commit',
      hash: 'newest'
    });
  });

  it('drops a stale file selection to the default file', () => {
    expect(
      restoreSelection({
        ...base,
        prevFile: 'gone.ts',
        statusPaths: ['other.ts'],
        defaultFile: { file: 'other.ts', staged: false }
      })
    ).toEqual({ kind: 'file', file: 'other.ts', staged: false });
  });

  it('selects nothing on an empty repo', () => {
    expect(restoreSelection(base)).toEqual({ kind: 'none' });
  });
});
