// Pure git unified-diff projection: hunk strings → the unified and split row
// models the diff renderer binds. No Vue, no DOM — the interface is the test
// surface. Highlighting (whole-file context + per-line fallback) and word-level
// emphasis happen here so the component is left with binding and virtualization.

import hljs from 'highlight.js';
import { diffLang, escapeHtml, highlightLines } from '~/utils/highlight';
import { wordDiffRanges } from '~/utils/wordDiff';
import type { ParsedDiff, SplitRow, UnifiedRow } from '~/types/diff';

export function parseDiff({
  hunks,
  fileName,
  oldContent,
  newContent
}: {
  hunks: string[];
  fileName: string;
  oldContent?: string;
  newContent?: string;
}): ParsedDiff {
  const lang = diffLang(fileName);

  // Per-line highlight; falls back to escaped text on any failure.
  const hl = (text: string): string => {
    if (!text) return '';
    if (!lang) return escapeHtml(text);
    try {
      return hljs.highlight(text, { language: lang, ignoreIllegals: true })
        .value;
    } catch {
      return escapeHtml(text);
    }
  };

  // Whole-file highlight, one entry per line (index = line number - 1), so a
  // line keeps its cross-line context (e.g. a Vue SFC's script/style). Falls
  // back to per-line hl() when a line isn't found.
  const oldHi = highlightLines({ text: oldContent ?? '', lang });
  const newHi = highlightLines({ text: newContent ?? '', lang });
  const hlOld = ({ no, text }: { no: number; text: string }): string =>
    oldHi[no - 1] ?? hl(text);
  const hlNew = ({ no, text }: { no: number; text: string }): string =>
    newHi[no - 1] ?? hl(text);

  // Word-level diff of a removed/added line pair: emphasise the changed middle
  // (common prefix/suffix trimmed by the pure wordDiffRanges helper).
  const wordDiff = ({
    a,
    b
  }: {
    a: string;
    b: string;
  }): { oldHtml: string; newHtml: string } => {
    const { start, aEnd, bEnd } = wordDiffRanges({ a, b });
    const wrap = (s: string, cls: string) =>
      s ? `<span class="${cls}">${escapeHtml(s)}</span>` : '';
    return {
      oldHtml:
        escapeHtml(a.slice(0, start)) +
        wrap(a.slice(start, aEnd), 'wd-del') +
        escapeHtml(a.slice(aEnd)),
      newHtml:
        escapeHtml(b.slice(0, start)) +
        wrap(b.slice(start, bEnd), 'wd-add') +
        escapeHtml(b.slice(bEnd))
    };
  };

  const unified: UnifiedRow[] = [];
  hunks.forEach((hunk, hunkIndex) => {
    const lines = hunk.split('\n');
    const header = lines[0] ?? '';
    const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    let oldNo = m ? Number(m[1]) : 1;
    let newNo = m ? Number(m[2]) : 1;
    unified.push({ type: 'hunk', html: escapeHtml(header), hunkIndex });

    // Buffer consecutive removals/additions so a modified line (a -/+ pair) can
    // be word-diffed — the changed substring gets emphasised like in split mode.
    let dels: { text: string; oldNo: number }[] = [];
    let adds: { text: string; newNo: number }[] = [];
    const flush = () => {
      const n = Math.max(dels.length, adds.length);
      const delHtml: string[] = [];
      const addHtml: string[] = [];
      for (let i = 0; i < n; i++) {
        const d = dels[i];
        const a = adds[i];
        if (d && a) {
          const wd = wordDiff({ a: d.text, b: a.text });
          delHtml.push(wd.oldHtml);
          addHtml.push(wd.newHtml);
        } else if (d) delHtml.push(hlOld({ no: d.oldNo, text: d.text }));
        else if (a) addHtml.push(hlNew({ no: a.newNo, text: a.text }));
      }
      dels.forEach((d, i) =>
        unified.push({
          type: 'del',
          oldNo: d.oldNo,
          html: delHtml[i]!,
          text: d.text
        })
      );
      adds.forEach((a, i) =>
        unified.push({
          type: 'add',
          newNo: a.newNo,
          html: addHtml[i]!,
          text: a.text
        })
      );
      dels = [];
      adds = [];
    };

    for (let i = 1; i < lines.length; i++) {
      const l = lines[i] ?? '';
      const c = l[0];
      const text = l.slice(1);
      if (c === '\\') continue;
      if (c === '+') adds.push({ text, newNo: newNo++ });
      else if (c === '-') dels.push({ text, oldNo: oldNo++ });
      else {
        flush();
        const o = oldNo++;
        const nn = newNo++;
        unified.push({
          type: 'context',
          oldNo: o,
          newNo: nn,
          html: hlNew({ no: nn, text }),
          text
        });
      }
    }
    flush();
  });

  // Side-by-side projection of the unified rows: pair buffered -/+ runs into
  // left/right cells (word-diffing a matched pair), pad the shorter side.
  const split: SplitRow[] = [];
  let dels: UnifiedRow[] = [];
  let adds: UnifiedRow[] = [];
  const flushSplit = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i];
      const a = adds[i];
      let leftHtml = d?.html ?? '';
      let rightHtml = a?.html ?? '';
      if (d && a && d.text !== undefined && a.text !== undefined) {
        const wd = wordDiff({ a: d.text, b: a.text });
        leftHtml = wd.oldHtml;
        rightHtml = wd.newHtml;
      }
      split.push({
        left: d
          ? { no: d.oldNo, html: leftHtml, type: 'del' }
          : { html: '', type: 'empty' },
        right: a
          ? { no: a.newNo, html: rightHtml, type: 'add' }
          : { html: '', type: 'empty' }
      });
    }
    dels = [];
    adds = [];
  };
  for (const r of unified) {
    if (r.type === 'del') dels.push(r);
    else if (r.type === 'add') adds.push(r);
    else {
      flushSplit();
      if (r.type === 'hunk')
        split.push({ hunk: r.html, hunkIndex: r.hunkIndex });
      else
        split.push({
          left: { no: r.oldNo, html: r.html, type: 'context' },
          right: { no: r.newNo, html: r.html, type: 'context' }
        });
    }
  }
  flushSplit();

  return { unified, split };
}
