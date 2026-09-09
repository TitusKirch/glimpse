import { describe, expect, it, vi } from 'vitest';
import { parseDiff } from './parseDiff';

// The real whole-file highlighter, wrapped so a test can see which sides were
// highlighted at all — the cost this module is trying not to pay twice is one
// HTML string per line of a whole file, which no assertion on the rows shows.
const highlighted = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('~/utils/highlight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/utils/highlight')>();
  return {
    ...actual,
    highlightLines: (args: { text: string; lang: string }) => {
      highlighted.calls.push(args.text);
      return actual.highlightLines(args);
    }
  };
});

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

describe('parseDiff — building only the rendered model', () => {
  // A run with a paired -/+ (word-diffed), context either side.
  const hunks = ['@@ -1,3 +1,3 @@\n ctx\n-old\n+new\n tail'];
  const only = (mode: 'unified' | 'split') =>
    parseDiff({ hunks, fileName: 'x.txt', mode });

  // The shapes the walk branches on: a word-diffed pair, an unbalanced run (the
  // split view pads it), a `\ No newline` marker, and more than one hunk. A
  // mode-scoped build has to reproduce each of them exactly.
  const shapes = [
    hunks,
    ['@@ -1,2 +1,1 @@\n-a\n-b\n+c'],
    ['@@ -0,0 +1,1 @@\n+added\n\\ No newline at end of file'],
    ['@@ -1,1 +1,1 @@\n ctx', '@@ -9,1 +9,2 @@\n keep\n+extra']
  ];

  it('leaves the split rows unbuilt when only the unified view renders', () => {
    expect(only('unified').split).toEqual([]);
  });

  it('leaves the unified rows unbuilt when only the split view renders', () => {
    expect(only('split').unified).toEqual([]);
  });

  it('builds the same unified rows whether or not split is built too', () => {
    for (const h of shapes)
      expect(
        parseDiff({ hunks: h, fileName: 'x.txt', mode: 'unified' }).unified
      ).toEqual(txt(h).unified);
  });

  it('builds the same split rows whether or not unified is built too', () => {
    for (const h of shapes)
      expect(
        parseDiff({ hunks: h, fileName: 'x.txt', mode: 'split' }).split
      ).toEqual(txt(h).split);
  });

  it('gives a split cell the same word-diff html as its unified row', () => {
    const { unified, split } = txt(hunks);
    const del = unified.find((r) => r.type === 'del')!;
    const add = unified.find((r) => r.type === 'add')!;
    const row = split.find((r) => r.left?.type === 'del')!;
    expect(row.left!.html).toBe(del.html);
    expect(row.right!.html).toBe(add.html);
  });

  it('highlights only the file side a row actually reads', () => {
    highlighted.calls.length = 0;
    parseDiff({
      hunks: ['@@ -1,1 +1,2 @@\n ctx\n+added'],
      fileName: 'x.ts',
      oldContent: 'ctx',
      newContent: 'ctx\nadded'
    });
    // Nothing was deleted, so no row ever looks the old file up — highlighting
    // it would cost an HTML string per line of a whole file for nothing.
    expect(highlighted.calls).toEqual(['ctx\nadded']);
  });
});
