// Shared syntax-highlighting helpers (highlight.js) for the diff and blame
// views. Token colours come from the `.hljs-diff` CSS in tailwind.css, so the
// rendering container must carry that class.
import hljs from 'highlight.js';

const LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'xml',
  html: 'xml',
  xml: 'xml',
  svg: 'xml',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  rs: 'rust',
  go: 'go',
  py: 'python',
  rb: 'ruby',
  php: 'php',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  md: 'markdown',
  sql: 'sql',
  lua: 'lua'
};

/** highlight.js language id for a file name, or '' when unknown/unsupported. */
export function diffLang(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const name = LANG[ext];
  return name && hljs.getLanguage(name) ? name : '';
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c
  );
}

/** Highlight one line of code; falls back to escaped text on any failure. */
export function highlightLine({
  text,
  lang
}: {
  text: string;
  lang: string;
}): string {
  if (!text) return '';
  if (!lang) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

/**
 * Split highlight.js output (which only ever emits `<span>` pairs and escaped
 * text) into one HTML string per source line. A token whose span opens on one
 * line and closes on a later one — a block comment, a template literal, or the
 * embedded `<script>`/`<style>` of a Vue SFC — has its open spans closed at each
 * line end and reopened at the next line start, so every line is self-contained.
 */
function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = []; // currently-open opening tags, outermost first
  let current = '';
  const re = /(<\/span>)|(<span[^>]*>)|(\n)|([^<\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, close, openTag, nl, text] = m;
    if (nl !== undefined) {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.join('');
    } else if (close !== undefined) {
      open.pop();
      current += close;
    } else if (openTag !== undefined) {
      open.push(openTag);
      current += openTag;
    } else if (text !== undefined) {
      current += text;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Highlight a whole file at once and return one HTML string per line. Unlike
 * per-line highlighting this keeps cross-line context (so a Vue SFC's script and
 * style sections highlight, not just its template). Index is line-number - 1.
 */
export function highlightLines({
  text,
  lang
}: {
  text: string;
  lang: string;
}): string[] {
  if (!lang) return text.split('\n').map(escapeHtml);
  try {
    const html = hljs.highlight(text, {
      language: lang,
      ignoreIllegals: true
    }).value;
    return splitHighlightedLines(html);
  } catch {
    return text.split('\n').map(escapeHtml);
  }
}
