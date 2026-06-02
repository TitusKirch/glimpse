import { describe, expect, it } from 'vitest';
import { parseDiff } from './parseDiff';

// 'x.txt' has no highlight.js language, so line html is just escaped text —
// which keeps the assertions about the hunk→rows transformation deterministic.
const txt = (hunks: string[]) => parseDiff({ hunks, fileName: 'x.txt' });

describe('parseDiff — unified', () => {
  it('emits a hunk header, then context and a deletion with line numbers', () => {
    // Whole-file content drives highlighting; the per-line lookup reads it by
    // line number, so supply the files the hunk came from.
    const { unified } = parseDiff({
      hunks: ['@@ -1,2 +1,1 @@\n ctx\n-gone'],
      fileName: 'x.txt',
      oldContent: 'ctx\ngone',
      newContent: 'ctx'
    });
    expect(unified.map((r) => r.type)).toEqual(['hunk', 'context', 'del']);
    expect(unified[0]).toMatchObject({ type: 'hunk', hunkIndex: 0 });
    expect(unified[1]).toMatchObject({
      oldNo: 1,
      newNo: 1,
      text: 'ctx',
      html: 'ctx'
    });
    expect(unified[2]).toMatchObject({ type: 'del', oldNo: 2, html: 'gone' });
  });

  it('word-diffs a modified -/+ pair (changed middle wrapped)', () => {
    const { unified } = txt(['@@ -1 +1 @@\n-foo\n+fox']);
    const del = unified.find((r) => r.type === 'del')!;
    const add = unified.find((r) => r.type === 'add')!;
    expect(del.html).toBe('fo<span class="wd-del">o</span>');
    expect(add.html).toBe('fo<span class="wd-add">x</span>');
  });

  it('escapes HTML in line content', () => {
    const { unified } = parseDiff({
      hunks: ['@@ -1,0 +1 @@\n+<b>'],
      fileName: 'x.txt',
      newContent: '<b>'
    });
    expect(unified.find((r) => r.type === 'add')!.html).toBe('&lt;b&gt;');
  });

  it('parses the new starting line from the @@ header', () => {
    const { unified } = txt(['@@ -10,1 +20,1 @@\n ctx']);
    expect(unified[1]).toMatchObject({ oldNo: 10, newNo: 20 });
  });
});

describe('parseDiff — split', () => {
  it('projects a modified pair into one row: left del, right add', () => {
    const { split } = txt(['@@ -1,2 +1,2 @@\n ctx\n-old\n+new']);
    expect(split[0]).toMatchObject({ hunkIndex: 0 });
    expect(split[1]!.left).toMatchObject({ type: 'context', no: 1 });
    expect(split[2]!.left!.type).toBe('del');
    expect(split[2]!.right!.type).toBe('add');
  });

  it('pads the shorter side with an empty cell', () => {
    const { split } = txt(['@@ -1,2 +1,1 @@\n-a\n-b\n+c']);
    const rows = split.filter((r) => r.left || r.right);
    expect(rows.some((r) => r.right?.type === 'empty')).toBe(true);
  });
});
