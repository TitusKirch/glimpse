// The facts a fatal-error report needs, and the markdown a user pastes into an
// issue. Deliberately pure and dependency-free: the one page that renders these
// is the page that shows *because* something in the app shell broke, so nothing
// here may reach for a store, for IPC or for i18n. See app/error.vue.

export type BuildKind = 'release' | 'dev';

export type Diagnostics = {
  /** App version, baked in at build time (never read back over IPC). */
  version: string;
  build: BuildKind;
  /** OS name + version — from the user agent, or the OS plugin once it answers. */
  os: string;
  /** WebView runtime and version, read off the user agent. */
  webview: string;
  route: string;
  /** e.g. "500 Internal Server Error"; absent for a plain thrown error. */
  status?: string;
  /**
   * What went wrong. Absent when nothing did — the Diagnostics page reports the
   * same facts about a perfectly healthy app.
   */
  message?: string;
  /** Raw, as the browser reported it. Absent when the error carried none. */
  stack?: string;
  // The rest are enrichment only the Settings → Diagnostics page can reach: they
  // need the app shell (useAppVersion) or a round-trip over IPC, which is exactly
  // what the fatal error page cannot rely on. Optional fields on the one format
  // rather than a second format, so both surfaces paste the same block and a
  // reader never has to work out which one they were handed.
  /** Release channel of the running build: `stable`, `beta` or `experiment`. */
  channel?: string;
  /** Slug of the running experiment build; absent on stable/beta/dev. */
  experiment?: string;
  /** `git --version` as the resolved git reported it. */
  git?: string;
  /** Which git that was — native, or the WSL distro driving it. */
  gitTarget?: string;
};

/**
 * OS name and version read off a user agent. This is the reading that is
 * available *immediately*, with no IPC — `tauri-plugin-os` replaces it with the
 * real thing when (and only if) it answers.
 */
export function osFromUserAgent(ua: string): string {
  const windows = /Windows NT ([\d.]+)/.exec(ua);
  if (windows) return `Windows NT ${windows[1]}`;
  const mac = /Mac OS X ([\d_.]+)/.exec(ua);
  if (mac) return `macOS ${mac[1].replaceAll('_', '.')}`;
  const linux = /X11; Linux ([^);]+)/.exec(ua);
  if (linux) return `Linux ${linux[1].trim()}`;
  return 'unknown';
}

/**
 * The WebView runtime behind the window. WebView2 advertises both `Edg/` and
 * `Chrome/`, so the Edge token is tried first; WebKitGTK and WKWebView share
 * `AppleWebKit/` and are told apart by the platform token.
 */
export function webviewFromUserAgent(ua: string): string {
  const edge = /Edg(?:e|A|iOS)?\/([\d.]+)/.exec(ua);
  if (edge) return `WebView2 ${edge[1]}`;
  const chrome = /Chrome\/([\d.]+)/.exec(ua);
  if (chrome) return `Chromium ${chrome[1]}`;
  const webkit = /AppleWebKit\/([\d.]+)/.exec(ua);
  if (webkit) {
    if (ua.includes('Macintosh')) return `WKWebView ${webkit[1]}`;
    if (ua.includes('Linux')) return `WebKitGTK ${webkit[1]}`;
    return `WebKit ${webkit[1]}`;
  }
  return 'unknown';
}

/** Human-readable names for the `tauri-plugin-os` OS identifiers. */
const OS_NAMES: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  ios: 'iOS',
  android: 'Android'
};

/**
 * The `tauri-plugin-os` reading as one line. Every part is optional because the
 * plugin is enrichment, not a precondition — a partial answer still beats the
 * user-agent guess it replaces.
 */
export function formatPluginOs(
  type: string,
  version: string,
  arch: string
): string {
  const name = type ? (OS_NAMES[type] ?? type) : '';
  const head = [name, version].filter(Boolean).join(' ');
  if (!head) return 'unknown';
  return arch ? `${head} (${arch})` : head;
}

/** Human-readable names for the `platform::resolve()` flavors. */
const FLAVOR_NAMES: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux'
};

/**
 * Which git actually runs, as one line — the WSL distro driving it, or the host
 * platform when git is native. Named the way `platform::resolve()` decides it,
 * because "it works on my machine" and "it works through my distro's git" are
 * the two answers a bug report has to tell apart.
 */
export function formatGitTarget(
  flavor: string,
  distro?: string | null
): string {
  if (flavor === 'wsl') return distro ? `WSL · ${distro}` : 'WSL';
  const name = FLAVOR_NAMES[flavor];
  return name ? `Native (${name})` : 'unknown';
}

/**
 * The route that was on screen. glimpse is a single-page app with no router, so
 * the location *is* the route — and reading it needs nothing that could have
 * been part of the failure.
 */
export function routeFromLocation(
  loc?: { pathname?: string; search?: string; hash?: string } | null
): string {
  const path = loc?.pathname || '/';
  return `${path}${loc?.search ?? ''}${loc?.hash ?? ''}`;
}

/**
 * The whole block as markdown, ready to paste into a bug report. Keeps the
 * stack in a fenced code block so GitHub does not reflow it, and drops the
 * sections there is nothing to say about rather than printing empty ones.
 */
export function formatDiagnosticsMarkdown(d: Diagnostics): string {
  const lines = [
    '**glimpse diagnostics**',
    '',
    `- Version: ${d.version} (${d.build})`,
    `- OS: ${d.os}`,
    `- WebView: ${d.webview}`
  ];
  if (d.channel) lines.push(`- Channel: ${d.channel}`);
  if (d.experiment) lines.push(`- Experiment: ${d.experiment}`);
  if (d.git) lines.push(`- Git: ${d.git}`);
  if (d.gitTarget) lines.push(`- Git target: ${d.gitTarget}`);
  lines.push(`- Route: ${d.route}`);
  if (d.status) lines.push(`- Status: ${d.status}`);
  if (d.message) lines.push(`- Message: ${d.message}`);
  if (d.stack) {
    lines.push('', 'Stack trace:', '', '```', d.stack, '```');
  }
  return `${lines.join('\n')}\n`;
}
