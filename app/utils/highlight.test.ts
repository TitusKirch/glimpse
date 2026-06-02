import { describe, expect, it } from 'vitest';
import { highlightLines } from './highlight';

// Count unbalanced spans on a single line — should always be 0 once split.
function spanBalance(line: string): number {
  const opens = (line.match(/<span[^>]*>/g) ?? []).length;
  const closes = (line.match(/<\/span>/g) ?? []).length;
  return opens - closes;
}

describe('highlightLines', () => {
  it('returns one entry per source line', () => {
    const src = 'const a = 1\nconst b = 2\nconst c = 3';
    expect(highlightLines(src, 'javascript')).toHaveLength(3);
  });

  it('keeps every line self-contained across a multi-line token', () => {
    // A template literal spans three lines — its highlight span must be closed
    // and reopened per line, so no line leaks open/closed tags.
    const src = 'const x = `line one\nline two\nline three`;\nconst y = 2;';
    const lines = highlightLines(src, 'javascript');
    expect(lines).toHaveLength(4);
    for (const line of lines) expect(spanBalance(line)).toBe(0);
  });

  it('escapes and splits when no language is given', () => {
    expect(highlightLines('a < b\nc > d', '')).toEqual([
      'a &lt; b',
      'c &gt; d'
    ]);
  });

  it('highlights a Vue SFC script section (xml sub-language)', () => {
    const src = '<template>\n  <div>{{ x }}</div>\n</template>';
    const lines = highlightLines(src, 'xml');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(spanBalance(line)).toBe(0);
  });
});
