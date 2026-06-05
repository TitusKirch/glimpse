import { describe, expect, it } from 'vitest';
import {
  diffLang,
  escapeHtml,
  highlightLine,
  highlightLines
} from './highlight';

describe('diffLang', () => {
  it('maps known extensions to highlight.js languages', () => {
    expect(diffLang('a.ts')).toBe('typescript');
    expect(diffLang('a.RS')).toBe('rust');
    expect(diffLang('component.vue')).toBe('xml');
  });

  it('returns empty for unknown or extensionless names', () => {
    expect(diffLang('a.unknownext')).toBe('');
    expect(diffLang('Makefile')).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes &, < and >', () => {
    expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });
});

describe('highlightLine', () => {
  it('returns empty for empty text', () => {
    expect(highlightLine({ text: '', lang: 'javascript' })).toBe('');
  });

  it('escapes (no highlight) when no language is given', () => {
    expect(highlightLine({ text: 'a < b', lang: '' })).toBe('a &lt; b');
  });

  it('highlights with a real language', () => {
    expect(
      highlightLine({ text: 'const a = 1', lang: 'javascript' })
    ).toContain('<span');
  });

  it('falls back to escaped text on an unknown language', () => {
    expect(highlightLine({ text: 'a < b', lang: 'not-a-real-lang' })).toBe(
      'a &lt; b'
    );
  });
});

describe('highlightLines fallback', () => {
  it('escapes and splits when the language throws', () => {
    expect(
      highlightLines({ text: 'a < b\nc', lang: 'not-a-real-lang' })
    ).toEqual(['a &lt; b', 'c']);
  });
});

// Count unbalanced spans on a single line — should always be 0 once split.
function spanBalance(line: string): number {
  const opens = (line.match(/<span[^>]*>/g) ?? []).length;
  const closes = (line.match(/<\/span>/g) ?? []).length;
  return opens - closes;
}

describe('highlightLines', () => {
  it('returns one entry per source line', () => {
    const src = 'const a = 1\nconst b = 2\nconst c = 3';
    expect(highlightLines({ text: src, lang: 'javascript' })).toHaveLength(3);
  });

  it('keeps every line self-contained across a multi-line token', () => {
    // A template literal spans three lines — its highlight span must be closed
    // and reopened per line, so no line leaks open/closed tags.
    const src = 'const x = `line one\nline two\nline three`;\nconst y = 2;';
    const lines = highlightLines({ text: src, lang: 'javascript' });
    expect(lines).toHaveLength(4);
    for (const line of lines) expect(spanBalance(line)).toBe(0);
  });

  it('escapes and splits when no language is given', () => {
    expect(highlightLines({ text: 'a < b\nc > d', lang: '' })).toEqual([
      'a &lt; b',
      'c &gt; d'
    ]);
  });

  it('highlights a Vue SFC script section (xml sub-language)', () => {
    const src = '<template>\n  <div>{{ x }}</div>\n</template>';
    const lines = highlightLines({ text: src, lang: 'xml' });
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(spanBalance(line)).toBe(0);
  });

  // Security invariant (the diff/blame views render this via v-html): the only
  // tags the output may ever contain are highlight.js <span>s. A source `<`/`>`
  // must come back escaped, never as a live element — otherwise a crafted file
  // could inject markup. This guards against a highlight.js upgrade or a
  // splitHighlightedLines regression silently breaking the escaping.
  it('never emits a tag other than <span> and escapes source markup', () => {
    const malicious =
      'const s = "<img src=x onerror=alert(1)>";\n<script>alert(2)</script>\nok';
    for (const lang of ['javascript', 'xml', '']) {
      const lines = highlightLines({ text: malicious, lang });
      const html = lines.join('\n');
      // No injected elements survive — only span tags are allowed.
      const tags = html.match(/<\/?[a-zA-Z][^>]*>/g) ?? [];
      for (const tag of tags) {
        expect(/^<\/?span[\s>]/.test(tag) || tag === '</span>').toBe(true);
      }
      // Source markup comes back escaped (&lt;img …) — never as a live element.
      // (`onerror=` may still appear as escaped *text*, which is harmless.)
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<script');
    }
  });
});
