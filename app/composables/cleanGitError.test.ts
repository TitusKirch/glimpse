import { describe, expect, it } from 'vitest';
import { cleanGitError } from './cleanGitError';

describe('cleanGitError', () => {
  it('drops indented file lists, the trailing Aborting line and the error prefix', () => {
    const raw =
      'error: Your local changes to the following files would be overwritten by checkout:\n\tapp/foo.ts\n\tapp/bar.ts\nPlease commit your changes or stash them.\nAborting';
    expect(cleanGitError(raw)).toBe(
      'Your local changes to the following files would be overwritten by checkout:\nPlease commit your changes or stash them.'
    );
  });

  it('strips the leading severity prefix and trims', () => {
    expect(cleanGitError('  fatal: not a git repository  ')).toBe(
      'not a git repository'
    );
  });

  it('falls back to the raw text when filtering leaves nothing', () => {
    expect(cleanGitError('\tonly an indented line')).toBe(
      'only an indented line'
    );
  });
});
