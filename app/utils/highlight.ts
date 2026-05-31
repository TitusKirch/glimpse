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
export function highlightLine(text: string, lang: string): string {
  if (!text) return '';
  if (!lang) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}
