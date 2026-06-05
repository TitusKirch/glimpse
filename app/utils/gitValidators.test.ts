import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  branchNameSchema,
  remoteNameSchema,
  remoteUrlSchema,
  tagNameSchema
} from './gitValidators';

const ok = (schema: ZodType, v: string) => schema.safeParse(v).success;

describe('branchNameSchema', () => {
  it('accepts ordinary branch names', () => {
    expect(ok(branchNameSchema, 'feature/foo')).toBe(true);
    expect(ok(branchNameSchema, 'release-1.2')).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(ok(branchNameSchema, '')).toBe(false);
    expect(ok(branchNameSchema, '   ')).toBe(false);
  });

  it('rejects a leading dash (option injection)', () => {
    expect(ok(branchNameSchema, '-D')).toBe(false);
    expect(ok(branchNameSchema, '--upload-pack=x')).toBe(false);
  });

  it('rejects whitespace and git-special characters', () => {
    for (const v of ['a b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b']) {
      expect(ok(branchNameSchema, v)).toBe(false);
    }
  });

  it('rejects the patterns git-check-ref-format forbids', () => {
    for (const v of ['a..b', 'a@{b', '/a', 'a/', 'a.lock', 'HEAD']) {
      expect(ok(branchNameSchema, v)).toBe(false);
    }
  });

  it('trims surrounding whitespace', () => {
    expect(branchNameSchema.parse('  foo  ')).toBe('foo');
  });
});

describe('tagNameSchema', () => {
  it('shares the branch rules', () => {
    expect(ok(tagNameSchema, 'v1.0.0')).toBe(true);
    expect(ok(tagNameSchema, '-bad')).toBe(false);
  });
});

describe('remoteNameSchema', () => {
  it('accepts conventional remote names', () => {
    expect(ok(remoteNameSchema, 'origin')).toBe(true);
    expect(ok(remoteNameSchema, 'up_stream-2')).toBe(true);
  });

  it('rejects names starting with punctuation', () => {
    expect(ok(remoteNameSchema, '.weird')).toBe(false);
    expect(ok(remoteNameSchema, '-x')).toBe(false);
  });
});

describe('remoteUrlSchema', () => {
  it('accepts the supported url/path forms', () => {
    for (const v of [
      'https://h/r.git',
      'http://h/r',
      'git@h:r.git',
      'ssh://h/r',
      'git://h/r',
      'file:///r',
      '/abs/path',
      './rel',
      '~/r'
    ]) {
      expect(ok(remoteUrlSchema, v)).toBe(true);
    }
  });

  it('rejects garbage', () => {
    expect(ok(remoteUrlSchema, 'not a url')).toBe(false);
    expect(ok(remoteUrlSchema, '')).toBe(false);
  });
});
