import { describe, expect, it } from 'vitest';
import {
  formatCommandLogMarkdown,
  formatCommandTime,
  formatDiagnosticsMarkdown,
  formatGitTarget,
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

describe('formatGitTarget', () => {
  it('names the distro whose git actually runs', () => {
    expect(formatGitTarget('wsl', 'Ubuntu-22.04')).toBe('WSL · Ubuntu-22.04');
  });

  it('names the host platform when git is native', () => {
    expect(formatGitTarget('linux')).toBe('Native (Linux)');
    expect(formatGitTarget('windows')).toBe('Native (Windows)');
    expect(formatGitTarget('macos')).toBe('Native (macOS)');
  });

  it('never claims a distro it was not told', () => {
    expect(formatGitTarget('wsl')).toBe('WSL');
  });

  it('says so rather than guessing when no repo has resolved a target', () => {
    expect(formatGitTarget('')).toBe('unknown');
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

  it('omits the message line when there is no error to report', () => {
    const md = formatDiagnosticsMarkdown({
      version: '0.11.0',
      build: 'release',
      os: 'Windows NT 10.0',
      webview: 'WebView2 131.0.2903.86',
      route: '/'
    });
    expect(md).not.toContain('Message');
    expect(md).not.toContain('Status');
    expect(md).not.toContain('Stack trace');
    expect(md).toContain('- Route: /');
  });

  it('carries the extras the Diagnostics page can reach', () => {
    const md = formatDiagnosticsMarkdown({
      ...base,
      channel: 'beta',
      experiment: 'hunk-commit',
      git: 'git version 2.43.0',
      gitTarget: 'WSL · Ubuntu-22.04'
    });
    expect(md).toContain('- Channel: beta');
    expect(md).toContain('- Experiment: hunk-commit');
    expect(md).toContain('- Git: git version 2.43.0');
    expect(md).toContain('- Git target: WSL · Ubuntu-22.04');
  });

  it('omits every extra the caller could not answer', () => {
    const md = formatDiagnosticsMarkdown(base);
    expect(md).not.toContain('Channel');
    expect(md).not.toContain('Experiment');
    expect(md).not.toContain('- Git');
  });

  it('stamps a recorded call with a sortable wall-clock time', () => {
    // UTC, not the viewer's locale: the block is pasted into an issue read by
    // someone else, and "14:09" in an unstated timezone is worse than useless
    // when it is lined up against a log from another machine.
    expect(formatCommandTime(Date.UTC(2026, 8, 8, 14, 9, 11, 7))).toBe(
      '14:09:11.007'
    );
  });

  it('pastes the command log as the block a bug report wants', () => {
    const md = formatCommandLogMarkdown([
      {
        seq: 1,
        at: Date.UTC(2026, 8, 8, 14, 9, 11, 0),
        command: 'git -C /r -c core.fsmonitor= status',
        durationMs: 12,
        ok: true,
        error: ''
      },
      {
        seq: 2,
        at: Date.UTC(2026, 8, 8, 14, 9, 12, 500),
        command: 'git -C /r fetch origin',
        durationMs: 4321,
        ok: false,
        error: "fatal: unable to access 'https://***@github.com/x.git/'"
      }
    ]);
    expect(md).toContain('**glimpse git command log**');
    // Newest first: the call someone is asking about is the one that just ran.
    const [first, second] = md
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => l.trim());
    expect(second).toBe(
      '- 14:09:11.000 · 12 ms · ok · `git -C /r -c core.fsmonitor= status`'
    );
    expect(first).toBe(
      '- 14:09:12.500 · 4321 ms · failed · `git -C /r fetch origin`'
    );
    // A failure carries git's own message, indented under its call.
    expect(md).toContain(
      "  fatal: unable to access 'https://***@github.com/x.git/'"
    );
  });

  it('says so rather than pasting an empty list', () => {
    expect(formatCommandLogMarkdown([])).toContain('no git calls recorded');
  });
});
