import { describe, expect, it } from 'vitest';
import {
  formatDiagnosticsMarkdown,
  formatPluginOs,
  osFromUserAgent,
  routeFromLocation,
  webviewFromUserAgent,
  type Diagnostics
} from './diagnostics';

// Real user-agent strings from the three webviews glimpse ships on.
const WEBVIEW2 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86';
const WEBKITGTK =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/8.0 Safari/605.1.15';
const WKWEBVIEW =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

describe('osFromUserAgent', () => {
  it('reads the Windows build off a WebView2 user agent', () => {
    expect(osFromUserAgent(WEBVIEW2)).toBe('Windows NT 10.0');
  });

  it('reads the Linux architecture off a WebKitGTK user agent', () => {
    expect(osFromUserAgent(WEBKITGTK)).toBe('Linux x86_64');
  });

  it('normalises the underscored macOS version', () => {
    expect(osFromUserAgent(WKWEBVIEW)).toBe('macOS 10.15.7');
  });

  it('never throws on a user agent it cannot read', () => {
    expect(osFromUserAgent('')).toBe('unknown');
    expect(osFromUserAgent('nonsense')).toBe('unknown');
  });
});

describe('webviewFromUserAgent', () => {
  it('names WebView2 by its Edg token, not the Chrome one it also carries', () => {
    expect(webviewFromUserAgent(WEBVIEW2)).toBe('WebView2 131.0.2903.86');
  });

  it('falls back to Chromium when only a Chrome token is present', () => {
    expect(
      webviewFromUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      )
    ).toBe('Chromium 131.0.0.0');
  });

  it('names WebKitGTK on Linux', () => {
    expect(webviewFromUserAgent(WEBKITGTK)).toBe('WebKitGTK 605.1.15');
  });

  it('names WKWebView on macOS', () => {
    expect(webviewFromUserAgent(WKWEBVIEW)).toBe('WKWebView 605.1.15');
  });

  it('never throws on a user agent it cannot read', () => {
    expect(webviewFromUserAgent('')).toBe('unknown');
    expect(webviewFromUserAgent('nonsense')).toBe('unknown');
  });
});

describe('formatPluginOs', () => {
  it('renders the OS plugin reading with a human-readable OS name', () => {
    expect(formatPluginOs('windows', '10.0.19045', 'x86_64')).toBe(
      'Windows 10.0.19045 (x86_64)'
    );
    expect(formatPluginOs('macos', '15.3.1', 'aarch64')).toBe(
      'macOS 15.3.1 (aarch64)'
    );
    expect(formatPluginOs('linux', '6.8.0', 'x86_64')).toBe(
      'Linux 6.8.0 (x86_64)'
    );
  });

  it('passes an OS name it does not know through unchanged', () => {
    expect(formatPluginOs('haiku', '1', 'x86')).toBe('haiku 1 (x86)');
  });

  it('drops the parts the plugin could not answer', () => {
    expect(formatPluginOs('windows', '', '')).toBe('Windows');
    expect(formatPluginOs('', '', '')).toBe('unknown');
  });
});

describe('routeFromLocation', () => {
  it('joins path, query and hash', () => {
    expect(
      routeFromLocation({ pathname: '/x', search: '?a=1', hash: '#b' })
    ).toBe('/x?a=1#b');
  });

  it('falls back to the root path when there is nothing to read', () => {
    expect(routeFromLocation({})).toBe('/');
    expect(routeFromLocation(undefined)).toBe('/');
  });
});

const base: Diagnostics = {
  version: '0.11.0',
  build: 'release',
  os: 'Windows NT 10.0',
  webview: 'WebView2 131.0.2903.86',
  route: '/',
  status: '500 Internal Server Error',
  message: 'ref is not defined',
  stack: 'ReferenceError: ref is not defined\n    at Ke (index-a1b2c3.js:1:2)'
};

describe('formatDiagnosticsMarkdown', () => {
  it('carries every diagnostic fact the error page shows', () => {
    const md = formatDiagnosticsMarkdown(base);
    expect(md).toContain('0.11.0');
    expect(md).toContain('release');
    expect(md).toContain('Windows NT 10.0');
    expect(md).toContain('WebView2 131.0.2903.86');
    expect(md).toContain('/');
    expect(md).toContain('500 Internal Server Error');
    expect(md).toContain('ref is not defined');
    expect(md).toContain('index-a1b2c3.js:1:2');
  });

  it('fences the stack trace so it survives a paste into an issue', () => {
    const md = formatDiagnosticsMarkdown(base);
    expect(md).toContain('```\nReferenceError: ref is not defined');
    expect(md.match(/```/g)).toHaveLength(2);
  });

  it('omits the stack section entirely when there is no stack', () => {
    const md = formatDiagnosticsMarkdown({ ...base, stack: undefined });
    expect(md).not.toContain('```');
    expect(md).not.toContain('Stack trace');
  });

  it('omits the status line when the error carries no status', () => {
    const md = formatDiagnosticsMarkdown({ ...base, status: undefined });
    expect(md).not.toContain('Status');
    expect(md).toContain('ref is not defined');
  });

  it('marks a dev build as such', () => {
    expect(formatDiagnosticsMarkdown({ ...base, build: 'dev' })).toContain(
      'dev'
    );
  });
});
