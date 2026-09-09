// Pure git unified-diff projection: hunk strings → the unified and split row
// models the diff renderer binds. No Vue, no DOM — the interface is the test
// surface. Highlighting (whole-file context + per-line fallback) and word-level
// emphasis happen here so the component is left with binding and virtualization.
//
// Only one of the two models is ever on screen, and a whole-file view holds a
// highlighted HTML string per row, so building the hidden one doubles the heap
// of the largest thing this app keeps in memory. `mode` scopes the walk to the
// projection that will render; omitting it builds both. Either way the two come
// off one pass over the hunks, so the hidden half cannot drift from the shown
// one and a modified line is word-diffed once rather than once per projection.

import hljs from 'highlight.js';
import { diffLang, escapeHtml, highlightLines } from '~/utils/highlight';
import { wordDiffRanges } from '~/utils/wordDiff';
import type { ParsedDiff, SplitRow, UnifiedRow } from '~/types/diff';

export function parseDiff({
  hunks,
  fileName,
  oldContent,
  newContent,
  mode
}: {
  hunks: string[];
  fileName: string;
  oldContent?: string;
  newContent?: string;
  // Which row model the caller will render. Omitted builds both — the shape of
  // the result is the same either way, the unwanted half is simply empty.
  mode?: 'unified' | 'split';
}): ParsedDiff {
  const wantUnified = mode !== 'split';
  const wantSplit = mode !== 'unified';
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
  // back to per-line hl() when a line isn't found. Built on first read, because
  // each side costs an HTML string per line of a whole file and the old side is
  // only ever read for a deletion with no matching addition — a diff without
  // one (a whole-file view of an unchanged or purely added file) never needs it.
  let oldHi: string[] | undefined;
  let newHi: string[] | undefined;
  const hlOld = ({ no, text }: { no: number; text: string }): string =>
    (oldHi ??= highlightLines({ text: oldContent ?? '', lang }))[no - 1] ??
    hl(text);
  const hlNew = ({ no, text }: { no: number; text: string }): string =>
    (newHi ??= highlightLines({ text: newContent ?? '', lang }))[no - 1] ??
    hl(text);

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
    const wrap = ({ s, cls }: { s: string; cls: string }) =>
      s ? `<span class="${cls}">${escapeHtml(s)}</span>` : '';
    return {
      oldHtml:
        escapeHtml(a.slice(0, start)) +
        wrap({ s: a.slice(start, aEnd), cls: 'wd-del' }) +
        escapeHtml(a.slice(aEnd)),
      newHtml:
        escapeHtml(b.slice(0, start)) +
        wrap({ s: b.slice(start, bEnd), cls: 'wd-add' }) +
        escapeHtml(b.slice(bEnd))
    };
  };

  const unified: UnifiedRow[] = [];
  const split: SplitRow[] = [];
  hunks.forEach((hunk, hunkIndex) => {
    const lines = hunk.split('\n');
    const header = lines[0] ?? '';
    const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    let oldNo = m ? Number(m[1]) : 1;
    let newNo = m ? Number(m[2]) : 1;
    const headerHtml = escapeHtml(header);
    if (wantUnified)
      unified.push({ type: 'hunk', html: headerHtml, hunkIndex });
    if (wantSplit) split.push({ hunk: headerHtml, hunkIndex });

    // 0-based line position within this hunk body (context/add/remove count;
    // `\ No newline` does not), threaded onto each row so line-level staging can
    // map a selected row back to the body index the backend expects.
    let bodyIdx = 0;
    // Buffer consecutive removals/additions so a modified line (a -/+ pair) can
    // be word-diffed — the changed substring gets emphasised like in split mode.
    let dels: { text: string; oldNo: number; lineIndex: number }[] = [];
    let adds: { text: string; newNo: number; lineIndex: number }[] = [];
    // Emit the buffered run into whichever models are being built. Both pair it
    // the same way — dels[i] against adds[i], the shorter side padded — so the
    // line HTML is computed once here and referenced by both projections.
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
      if (wantUnified) {
        dels.forEach((d, i) =>
          unified.push({
            type: 'del',
            oldNo: d.oldNo,
            html: delHtml[i]!,
            text: d.text,
            hunkIndex,
            lineIndex: d.lineIndex
          })
        );
        adds.forEach((a, i) =>
          unified.push({
            type: 'add',
            newNo: a.newNo,
            html: addHtml[i]!,
            text: a.text,
            hunkIndex,
            lineIndex: a.lineIndex
          })
        );
      }
      if (wantSplit) {
        // Side-by-side: the run's removals and additions sit on one row each,
        // the shorter side padded with an empty cell.
        for (let i = 0; i < n; i++) {
          const d = dels[i];
          const a = adds[i];
          split.push({
            left: d
              ? { no: d.oldNo, html: delHtml[i]!, type: 'del' }
              : { html: '', type: 'empty' },
            right: a
              ? { no: a.newNo, html: addHtml[i]!, type: 'add' }
              : { html: '', type: 'empty' }
          });
        }
      }
      dels = [];
      adds = [];
    };

    for (let i = 1; i < lines.length; i++) {
      const l = lines[i] ?? '';
      const c = l[0];
      const text = l.slice(1);
      if (c === '\\') continue;
      if (c === '+') adds.push({ text, newNo: newNo++, lineIndex: bodyIdx++ });
      else if (c === '-')
        dels.push({ text, oldNo: oldNo++, lineIndex: bodyIdx++ });
      else {
        flush();
        const o = oldNo++;
        const nn = newNo++;
        const lineIndex = bodyIdx++;
        const html = hlNew({ no: nn, text });
        if (wantUnified)
          unified.push({
            type: 'context',
            oldNo: o,
            newNo: nn,
            html,
            text,
            hunkIndex,
            lineIndex
          });
        // Both cells reference the one highlighted string rather than a copy —
        // context is the bulk of a whole-file view.
        if (wantSplit)
          split.push({
            left: { no: o, html, type: 'context' },
            right: { no: nn, html, type: 'context' }
          });
      }
    }
    flush();
  });

  return { unified, split };
}
