// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, onMounted, ref } from 'vue';
import ErrorPage from './error.vue';
import { useDiagnostics } from './composables/useDiagnostics';
import {
  formatDiagnosticsMarkdown,
  formatPluginOs,
  osFromUserAgent,
  routeFromLocation,
  webviewFromUserAgent
} from './utils/diagnostics';

const WEBVIEW2 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86';

// tauri-plugin-os is loaded lazily by the page; these let a spec make it answer,
// answer with something else, or never answer at all.
let osType: () => string;
let osVersion: () => string;
let osArch: () => string;
vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => osType(),
  version: () => osVersion(),
  arch: () => osArch()
}));

// The page reaches the Rust updater through a dynamic import, so the module has
// to be mocked rather than the composable: it deliberately does not use
// useUpdater() (see error.vue).
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args)
}));

const copy = vi.fn();
const opened = vi.fn();

const error = {
  statusCode: 500,
  statusMessage: 'Internal Server Error',
  message: 'ref is not defined',
  stack: 'ReferenceError: ref is not defined\n    at Ke (index-a1b2c3.js:1:2)'
};

beforeEach(() => {
  copy.mockClear();
  opened.mockClear();
  invoke.mockReset();
  localStorage.clear();
  osType = () => 'windows';
  osVersion = () => '10.0.19045';
  osArch = () => 'x86_64';
  Object.defineProperty(window.navigator, 'userAgent', {
    value: WEBVIEW2,
    configurable: true
  });
  // The page's Nuxt auto-imports, as free globals (see gitClient.test.ts) —
  // Vue's reactivity APIs included, since Nuxt auto-imports those too.
  const g = globalThis as Record<string, unknown>;
  g.ref = ref;
  g.computed = computed;
  g.onMounted = onMounted;
  g.useRuntimeConfig = () => ({ public: { appVersion: '0.11.0' } });
  g.isTauri = () => true;
  g.useCopy = () => copy;
  g.openExternal = opened;
  // The real shared assembly, not a stub: the page's contract is that these
  // facts come from the one place both it and Settings -> Diagnostics read, so
  // every spec below exercises that path. The fallback has a spec of its own.
  g.useDiagnostics = useDiagnostics;
  g.formatDiagnosticsMarkdown = formatDiagnosticsMarkdown;
  g.formatPluginOs = formatPluginOs;
  g.osFromUserAgent = osFromUserAgent;
  g.routeFromLocation = routeFromLocation;
  g.webviewFromUserAgent = webviewFromUserAgent;
});

function mountPage(props: Record<string, unknown> = { error }) {
  return mount(ErrorPage, { props });
}

function button(w: ReturnType<typeof mountPage>, label: string) {
  const found = w
    .findAll('button')
    .find((b) => b.text().toLowerCase().includes(label.toLowerCase()));
  if (!found) throw new Error(`no button matching ${label}`);
  return found;
}

describe('error page', () => {
  it('shows the error message and status', () => {
    const w = mountPage();
    expect(w.text()).toContain('ref is not defined');
    expect(w.text()).toContain('500');
    expect(w.text()).toContain('Internal Server Error');
  });

  it('shows the build-time version and build kind', () => {
    const w = mountPage();
    expect(w.text()).toContain('0.11.0');
    expect(w.text()).toMatch(/release|dev/);
  });

  it('shows the route and the webview read off the user agent', () => {
    const w = mountPage();
    expect(w.text()).toContain('WebView2 131.0.2903.86');
    expect(w.text()).toContain(routeFromLocation(window.location));
  });

  it('shows the stack trace, collapsed', () => {
    const w = mountPage();
    const details = w.find('details');
    expect(details.exists()).toBe(true);
    expect(details.attributes('open')).toBeUndefined();
    expect(details.text()).toContain('index-a1b2c3.js:1:2');
  });

  it('renders the OS from the user agent before the plugin answers', () => {
    const w = mountPage();
    expect(w.text()).toContain('Windows NT 10.0');
  });

  it('replaces the OS line once the plugin answers', async () => {
    const w = mountPage();
    await flushPromises();
    expect(w.text()).toContain('Windows 10.0.19045 (x86_64)');
  });

  it('keeps the user-agent reading when the plugin never answers', async () => {
    osType = () => {
      throw new Error('plugin unavailable');
    };
    const w = mountPage();
    await flushPromises();
    expect(w.text()).toContain('Windows NT 10.0');
  });

  it('does not ask the plugin outside the desktop shell', async () => {
    (globalThis as Record<string, unknown>).isTauri = () => false;
    const w = mountPage();
    await flushPromises();
    expect(w.text()).toContain('Windows NT 10.0');
  });

  it('copies every diagnostic as markdown', async () => {
    const w = mountPage();
    await button(w, 'Copy diagnostics').trigger('click');
    expect(copy).toHaveBeenCalledTimes(1);
    const md = copy.mock.calls[0]![0] as string;
    expect(md).toContain('0.11.0');
    expect(md).toContain('Windows NT 10.0');
    expect(md).toContain('WebView2 131.0.2903.86');
    expect(md).toContain('500 Internal Server Error');
    expect(md).toContain('ref is not defined');
    expect(md).toContain('index-a1b2c3.js:1:2');
  });

  it('opens the bug report template in the real browser', async () => {
    const w = mountPage();
    await button(w, 'Report').trigger('click');
    expect(opened).toHaveBeenCalledTimes(1);
    const url = opened.mock.calls[0]![0] as string;
    expect(url).toContain('github.com/TitusKirch/glimpse/issues/new');
    expect(url).toContain('template=bug_report.yml');
    // Prefills the template's short version & OS field; the stack goes via copy.
    expect(decodeURIComponent(url)).toContain('v0.11.0');
    expect(decodeURIComponent(url)).toContain('Windows NT 10.0');
  });

  it('still renders when the error carries nothing at all', () => {
    const w = mountPage({});
    expect(w.text().length).toBeGreaterThan(0);
    expect(w.find('details').exists()).toBe(false);
  });

  it('still reports every fact when the shared assembly is unavailable', async () => {
    // The failure this page exists for: a broken shared chunk takes
    // useDiagnostics() with it. The page must not go down with it.
    (globalThis as Record<string, unknown>).useDiagnostics = () => {
      throw new Error('shared chunk failed to load');
    };
    const w = mountPage();
    expect(w.text()).toContain('0.11.0');
    expect(w.text()).toContain('WebView2 131.0.2903.86');
    expect(w.text()).toContain('ref is not defined');
    expect(w.text()).toContain('500 Internal Server Error');
    // Down to the OS enrichment, which the fallback runs for itself.
    expect(w.text()).toContain('Windows NT 10.0');
    await flushPromises();
    expect(w.text()).toContain('Windows 10.0.19045 (x86_64)');
  });

  it('still renders when the runtime config cannot be read', () => {
    (globalThis as Record<string, unknown>).useRuntimeConfig = () => {
      throw new Error('no nuxt app');
    };
    const w = mountPage();
    expect(w.text()).toContain('unknown');
    expect(w.text()).toContain('ref is not defined');
  });
});

describe('error page — manual update check', () => {
  function select(w: ReturnType<typeof mountPage>) {
    return w.find('select#update-channel');
  }

  it('offers all three channels', () => {
    const options = select(mountPage())
      .findAll('option')
      .map((o) => o.attributes('value'));
    expect(options).toEqual(['stable', 'beta', 'experiment']);
  });

  it('defaults to the persisted channel', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({ releaseChannel: 'beta' })
    );
    expect((select(mountPage()).element as HTMLSelectElement).value).toBe(
      'beta'
    );
  });

  it('falls back to the running build channel when nothing is persisted', () => {
    (globalThis as Record<string, unknown>).useRuntimeConfig = () => ({
      public: { appVersion: '0.12.0-beta.3' }
    });
    expect((select(mountPage()).element as HTMLSelectElement).value).toBe(
      'beta'
    );
  });

  it('reports when the channel is already up to date', async () => {
    invoke.mockResolvedValue(null);
    const w = mountPage();
    await button(w, 'Check for updates').trigger('click');
    await flushPromises();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('No update available');
  });

  it('installs an available update and remembers the channel', async () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({ releaseChannel: 'stable', accent: 'blue' })
    );
    invoke.mockImplementation((command: string) =>
      command === 'check_update'
        ? Promise.resolve('0.13.0')
        : Promise.resolve(null)
    );
    const w = mountPage();
    await button(w, 'Check for updates').trigger('click');
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith('install_update', expect.anything());
    expect(w.text()).toContain('0.13.0');
    expect(w.text()).toContain('Restart glimpse');
    // Amended in place: every other setting survives.
    const blob = JSON.parse(localStorage.getItem('settings') as string);
    expect(blob).toEqual({ releaseChannel: 'stable', accent: 'blue' });
  });

  it('forces the install when switching away from the running channel', async () => {
    invoke.mockResolvedValue(null);
    const w = mountPage();
    await select(w).setValue('beta');
    await button(w, 'Check for updates').trigger('click');
    await flushPromises();
    // Running build is 0.11.0 (stable), so beta is a channel switch: force, or a
    // beta older than the installed stable would never be offered.
    expect(invoke).toHaveBeenCalledWith('check_update', {
      channel: 'beta',
      force: true
    });
  });

  it('never invents a settings blob when none was stored', async () => {
    invoke.mockImplementation((command: string) =>
      command === 'check_update'
        ? Promise.resolve('0.13.0')
        : Promise.resolve(null)
    );
    const w = mountPage();
    await button(w, 'Check for updates').trigger('click');
    await flushPromises();
    expect(localStorage.getItem('settings')).toBeNull();
  });

  it('explains the experiment channel instead of checking blindly', async () => {
    const w = mountPage();
    await select(w).setValue('experiment');
    await button(w, 'Check for updates').trigger('click');
    await flushPromises();
    expect(invoke).not.toHaveBeenCalled();
    expect(w.text()).toContain('No experiment is selected');
  });

  it('offers a restart once an update has installed', async () => {
    // The page shows because this build is broken, so installing a newer one and
    // then leaving the user on the old binary defeats the whole recovery.
    invoke.mockImplementation((command: string) =>
      command === 'check_update'
        ? Promise.resolve('0.13.0')
        : Promise.resolve(null)
    );
    const w = mountPage();
    expect(w.findAll('button').map((b) => b.text())).not.toContain(
      'Restart now'
    );
    await button(w, 'Check for updates').trigger('click');
    await flushPromises();
    await button(w, 'Restart now').trigger('click');
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith('restart_app');
  });

  it('reports a failed check inline and keeps the page readable', async () => {
    invoke.mockRejectedValue(new Error('no signing key'));
    const w = mountPage();
    await button(w, 'Check for updates').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Update failed');
    expect(w.text()).toContain('no signing key');
    // The diagnostics the page exists for are still on screen.
    expect(w.text()).toContain('ref is not defined');
  });
});
