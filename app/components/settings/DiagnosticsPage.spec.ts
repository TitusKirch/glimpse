// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, onMounted, ref } from 'vue';

// The page reads Nuxt auto-imports as free globals. The diagnostics assembly
// itself is the *real* composable — it is the thing under test here, so stubbing
// it would leave nothing but markup — while everything it or the page reaches
// past (the app shell, the repo store, IPC) is stubbed at that boundary.
const g = globalThis as Record<string, unknown>;
g.computed = computed;
g.onMounted = onMounted;
g.ref = ref;
g.useI18n = () => ({ t: (key: string) => key });
g.useRuntimeConfig = () => ({ public: { appVersion: '0.11.0' } });
// Whether the desktop shell is behind the page — the inspector only exists
// there, and the OS enrichment only runs there.
let desktop = false;
g.isTauri = () => desktop;
vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => 'linux',
  version: () => '6.8.0',
  arch: () => 'x86_64'
}));

const copied: string[] = [];
g.useCopy = () => async (text: string) => void copied.push(text);

// Mirrors useAppVersion()'s own derivation, so the page is exercised against the
// shape it really gets rather than a convenient one.
const version = ref('0.11.0');
const experiment = ref<string | null>(null);
const isExperiment = computed(() => !!experiment.value);
const isBeta = computed(
  () => version.value.includes('-') && !isExperiment.value
);
const appVersion = { version, experiment, isExperiment, isBeta };
g.useAppVersion = () => appVersion;

const active = ref<{ path: string; flavor: string; distro?: string } | null>(
  null
);
g.useRepoStore = () => ({
  get active() {
    return active.value;
  }
});

const gitVersion = vi.fn(async () => 'git version 2.43.0');
g.gitClient = { gitVersion };

const invoked: string[] = [];
g.tauriInvoke = async ({ command }: { command: string }) => {
  invoked.push(command);
  return null;
};

const { useDiagnostics } = await import('@/composables/useDiagnostics');
g.useDiagnostics = useDiagnostics;
const {
  formatDiagnosticsMarkdown,
  formatGitTarget,
  osFromUserAgent,
  routeFromLocation,
  webviewFromUserAgent
} = await import('@/utils/diagnostics');
Object.assign(g, {
  formatDiagnosticsMarkdown,
  formatGitTarget,
  osFromUserAgent,
  routeFromLocation,
  webviewFromUserAgent
});

const DiagnosticsPage = (await import('./DiagnosticsPage.vue')).default;

const global = {
  stubs: {
    NuxtIcon: { template: '<i />' },
    // No explicit $emit('click'): the listener falls through to the root
    // element, so re-emitting would fire the handler twice.
    UiButton: {
      props: ['disabled'],
      template: '<button :disabled="disabled"><slot /></button>'
    }
  }
};

async function mountPage() {
  const w = mount(DiagnosticsPage, { global });
  await Promise.resolve();
  await w.vm.$nextTick();
  return w;
}

beforeEach(() => {
  desktop = false;
  copied.length = 0;
  invoked.length = 0;
  active.value = null;
  experiment.value = null;
  version.value = '0.11.0';
  gitVersion.mockClear();
});

describe('DiagnosticsPage', () => {
  it('reports the same facts the fatal error page assembles', async () => {
    const w = await mountPage();
    expect(w.text()).toContain('0.11.0 (release)');
    expect(w.text()).toContain(routeFromLocation(window.location));
    expect(w.text()).toContain(webviewFromUserAgent(navigator.userAgent));
    expect(w.text()).toContain(osFromUserAgent(navigator.userAgent));
  });

  it('adds the release channel the fatal error page cannot reach', async () => {
    expect((await mountPage()).text()).toContain('stable');
    experiment.value = 'hunk-commit';
    const w = await mountPage();
    expect(w.text()).toContain('experiment');
    expect(w.text()).toContain('hunk-commit');
  });

  it('names the git that actually runs, not just the host', async () => {
    active.value = {
      path: '\\\\wsl$\\Ubuntu-22.04\\home\\t\\glimpse',
      flavor: 'wsl',
      distro: 'Ubuntu-22.04'
    };
    const w = await mountPage();
    expect(gitVersion).toHaveBeenCalledWith(active.value.path);
    expect(w.text()).toContain('git version 2.43.0');
    expect(w.text()).toContain('WSL · Ubuntu-22.04');
  });

  it('drops the git lines rather than guessing when no repo is open', async () => {
    gitVersion.mockResolvedValueOnce('');
    const w = await mountPage();
    expect(gitVersion).toHaveBeenCalledWith('');
    expect(w.text()).not.toContain('git version');
    expect(w.text()).not.toContain('unknown');
  });

  it('copies the whole report as the markdown a bug report pastes', async () => {
    active.value = { path: '/repo', flavor: 'linux' };
    const w = await mountPage();
    await w.get('button').trigger('click');
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain('**glimpse diagnostics**');
    expect(copied[0]).toContain('- Version: 0.11.0 (release)');
    expect(copied[0]).toContain('- Channel: stable');
    expect(copied[0]).toContain('- Git: git version 2.43.0');
    expect(copied[0]).toContain('- Git target: Native (Linux)');
    // Nothing crashed, so the error lines the fatal page carries stay out.
    expect(copied[0]).not.toContain('Message');
    expect(copied[0]).not.toContain('Stack trace');
  });

  it('opens the webview inspector on demand', async () => {
    desktop = true;
    const w = await mountPage();
    const inspector = w.findAll('button').at(-1)!;
    expect(inspector.attributes('disabled')).toBeUndefined();
    await inspector.trigger('click');
    expect(invoked).toEqual(['open_devtools']);
  });

  it('offers no inspector outside the desktop shell', async () => {
    const w = await mountPage();
    expect(w.findAll('button').at(-1)!.attributes('disabled')).toBeDefined();
  });
});
