import { describe, expect, it } from 'vitest';
import { parseConflicts } from './parseConflicts';

describe('parseConflicts', () => {
  it('splits text around a 2-way conflict region', () => {
    const segs = parseConflicts(
      'a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\nb'
    );
    expect(segs).toEqual([
      { type: 'text', text: 'a' },
      { type: 'conflict', ours: 'ours', theirs: 'theirs' },
      { type: 'text', text: 'b' }
    ]);
  });

  it('captures the base in diff3 style', () => {
    const segs = parseConflicts(
      '<<<<<<< HEAD\nours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> x'
    );
    expect(segs[0]).toEqual({
      type: 'conflict',
      ours: 'ours',
      theirs: 'theirs',
      base: 'base'
    });
  });

  it('returns a single text segment when there is no conflict', () => {
    expect(parseConflicts('plain\nfile')).toEqual([
      { type: 'text', text: 'plain\nfile' }
    ]);
  });
});
