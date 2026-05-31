import { describe, expect, it } from 'vitest';
import { wordDiffRanges } from './wordDiff';

describe('wordDiffRanges', () => {
  it('reports no change for identical strings', () => {
    const a = 'const x = 1;';
    const r = wordDiffRanges(a, a);
    expect(r.start).toBe(a.length);
    expect(r.aEnd).toBe(a.length);
    expect(r.bEnd).toBe(a.length);
    // Empty changed region on both sides.
    expect(r.aEnd - r.start).toBe(0);
    expect(r.bEnd - r.start).toBe(0);
  });

  it('isolates a single changed character', () => {
    const r = wordDiffRanges('foo', 'fox');
    expect('foo'.slice(r.start, r.aEnd)).toBe('o');
    expect('fox'.slice(r.start, r.bEnd)).toBe('x');
  });

  it('trims common prefix and suffix around an edit', () => {
    const a = 'const a = 1;';
    const b = 'const a = 42;';
    const r = wordDiffRanges(a, b);
    expect(a.slice(r.start, r.aEnd)).toBe('1');
    expect(b.slice(r.start, r.bEnd)).toBe('42');
    expect(a.slice(0, r.start)).toBe('const a = ');
  });

  it('handles pure insertion (one side empty change)', () => {
    const r = wordDiffRanges('ab', 'axb');
    expect('ab'.slice(r.start, r.aEnd)).toBe('');
    expect('axb'.slice(r.start, r.bEnd)).toBe('x');
  });
});
