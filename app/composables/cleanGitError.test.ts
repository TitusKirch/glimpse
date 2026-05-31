import { describe, expect, it } from 'vitest';
import { cleanGitError } from './cleanGitError';

describe('cleanGitError', () => {
  it('drops indented file lists and the trailing Aborting line', () => {
    const raw =
      'error: Your local changes to the following files would be overwritten by checkout:\n\tapp/foo.ts\n\tapp/bar.ts\nPlease commit your changes or stash them.\nAborting';
    expect(cleanGitError(raw)).toBe(
      'error: Your local changes to the following files would be overwritten by checkout:\nPlease commit your changes or stash them.'
    );
  });

  it('trims surrounding whitespace', () => {
    expect(cleanGitError('  fatal: not a git repository  ')).toBe(
      'fatal: not a git repository'
    );
  });

  it('falls back to the raw text when filtering leaves nothing', () => {
    expect(cleanGitError('\tonly an indented line')).toBe(
      'only an indented line'
    );
  });
});
