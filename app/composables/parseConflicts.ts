// Parse a conflicted file's content into plain-text and conflict-region segments
// the merge editor binds. Pure (no Vue/DOM) so it's the test surface. Handles
// both the default 2-way markers and the diff3 style (with a `|||||||` base).
import type { MergeSegment } from '~/types/conflict';

export function parseConflicts(text: string): MergeSegment[] {
  const lines = text.split('\n');
  const segments: MergeSegment[] = [];
  let buf: string[] = [];
  const flushText = () => {
    if (buf.length) {
      segments.push({ type: 'text', text: buf.join('\n') });
      buf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('<<<<<<<')) {
      flushText();
      const ours: string[] = [];
      const base: string[] = [];
      const theirs: string[] = [];
      let section: 'ours' | 'base' | 'theirs' = 'ours';
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('>>>>>>>')) {
        const l = lines[i] ?? '';
        if (l.startsWith('|||||||')) section = 'base';
        else if (l.startsWith('=======')) section = 'theirs';
        else if (section === 'ours') ours.push(l);
        else if (section === 'base') base.push(l);
        else theirs.push(l);
        i++;
      }
      i++; // skip the closing >>>>>>> marker
      segments.push({
        type: 'conflict',
        ours: ours.join('\n'),
        theirs: theirs.join('\n'),
        ...(base.length ? { base: base.join('\n') } : {})
      });
    } else {
      buf.push(line);
      i++;
    }
  }
  flushText();
  return segments;
}
