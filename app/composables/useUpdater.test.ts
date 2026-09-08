// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { createPinia, defineStore, setActivePinia } from 'pinia';

// The IPC seam and the toast surface are the two boundaries this composable is
// observed at, so they are the only things mocked; everything else — the stores,
// the simulated backend, `tauriInvoke` itself — is the real code under test.
const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
const isTauriProbe = vi.fn(() => true);
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  isTauri: isTauriProbe
}));

type ProgressPayload = { percent: number | null; done: boolean };
let emitProgress: ((payload: ProgressPayload) => void) | undefined;
const unlisten = vi.fn();
const listen = vi.fn(
  async (_name: string, cb: (e: { payload: ProgressPayload }) => void) => {
    emitProgress = (payload) => cb({ payload });
    return unlisten;
  }
);
vi.mock('@tauri-apps/api/event', () => ({ listen }));

type ToastCall = [string, Record<string, unknown> | undefined];
const toast = {
  info: vi.fn<(...a: ToastCall) => void>(),
  success: vi.fn<(...a: ToastCall) => void>(),
  error: vi.fn<(...a: ToastCall) => void>()
};
vi.mock('vue-sonner', () => ({ toast }));

// Nuxt auto-imports, as free globals. `useState` is Nuxt's, so it is stubbed;
// the app's own composables and stores are the real ones.
const g = globalThis as Record<string, unknown>;
const states = new Map<string, ReturnType<typeof ref>>();
g.ref = ref;
g.computed = computed;
g.defineStore = defineStore;
g.useState = <T>(key: string, init: () => T) => {
  if (!states.has(key)) states.set(key, ref(init()));
  return states.get(key)!;
};
g.useI18n = () => ({ t: (key: string) => key });

const { isTauri } = await import('./isTauri');
const { tauriInvoke } = await import('./tauriInvoke');
const { whenTauri } = await import('./whenTauri');
g.isTauri = isTauri;
g.tauriInvoke = tauriInvoke;
g.whenTauri = whenTauri;
const { useAppVersion } = await import('./useAppVersion');
g.useAppVersion = useAppVersion;
const { useSettingsStore } = await import('@/stores/settings');
g.useSettingsStore = useSettingsStore;
const { useSimulationStore } = await import('@/stores/simulation');
g.useSimulationStore = useSimulationStore;
const { simulatedUpdater } = await import('@/utils/updaterSimulation');
g.simulatedUpdater = simulatedUpdater;
const {
  SIM_UPDATE_AVAILABLE,
  SIM_UPDATE_CHECK_FAILED,
  SIM_UPDATE_DOWNLOAD_FAILED
} = await import('@/utils/simulations');

const { useUpdater } = await import('./useUpdater');

beforeEach(() => {
  setActivePinia(createPinia());
  states.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(null);
  isTauriProbe.mockReturnValue(true);
  listen.mockClear();
  unlisten.mockClear();
  emitProgress = undefined;
  for (const fn of Object.values(toast)) fn.mockReset();
});

/** The id the whole run's toast is updated under. */
const TOAST_ID = 'app-update';

/** The commands the composable sent over IPC, in order. */
function commands(): string[] {
  return invoke.mock.calls.map(([cmd]) => cmd);
}

/** The `description` of each call to one toast kind, in order. */
function descriptions(fn: (typeof toast)['info']): unknown[] {
  return fn.mock.calls.map(([, opts]) => opts?.description);
}

/**
 * Drive a run whose simulated download deliberately takes seconds — the pace is
 * what makes the toast watchable in the app, and waiting it out here would only
 * measure `setTimeout`.
 */
async function runWithTimers(run: Promise<unknown>) {
  vi.useFakeTimers();
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    await run;
  } finally {
    vi.useRealTimers();
  }
}

/** Click the "Restart" button on the toast the run just put up. */
async function takeRestartOffer() {
  const [, opts] = toast.success.mock.calls.at(-1)!;
  const action = opts?.action as { onClick: () => void };
  action.onClick();
  await Promise.resolve();
  await Promise.resolve();
}

describe('useUpdater simulations', () => {
  it('reports a simulated check failure without asking the real updater', async () => {
    useSimulationStore().set(SIM_UPDATE_CHECK_FAILED, true);
    await useUpdater().checkForUpdates();
    expect(toast.error).toHaveBeenCalledWith(
      'updater.failed',
      expect.objectContaining({
        description: expect.stringMatching(/simulated/i)
      })
    );
    // The load-bearing assertion: a simulated state never reaches the updater.
    expect(commands()).toEqual([]);
  });

  it('walks a simulated update from progress to the restart offer', async () => {
    useSimulationStore().set(SIM_UPDATE_AVAILABLE, true);
    await runWithTimers(useUpdater().checkForUpdates());

    // One toast, updated in place: every step carries the same id.
    const ids = [...toast.info.mock.calls, ...toast.success.mock.calls].map(
      ([, opts]) => opts?.id
    );
    expect(new Set(ids)).toEqual(new Set([TOAST_ID]));
    // It starts indeterminate, then counts, then becomes the success toast.
    expect(descriptions(toast.info)[0]).toBe('updater.installing');
    expect(descriptions(toast.info)).toContain('updater.downloading');
    expect(toast.success).toHaveBeenCalledWith(
      'updater.installed',
      expect.objectContaining({ id: TOAST_ID })
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(commands()).toEqual([]);
  });

  it('offers the restart rather than taking it, and never restarts a simulation', async () => {
    useSimulationStore().set(SIM_UPDATE_AVAILABLE, true);
    await runWithTimers(useUpdater().checkForUpdates());

    // Nothing has restarted just because the update installed.
    expect(commands()).toEqual([]);
    await takeRestartOffer();
    // …and taking the offer under a simulation still restarts nothing.
    expect(commands()).toEqual([]);
    expect(toast.info).toHaveBeenCalledWith('updater.restartSimulated');
  });

  it('reports a simulated download failure after showing progress', async () => {
    useSimulationStore().set(SIM_UPDATE_DOWNLOAD_FAILED, true);
    await runWithTimers(useUpdater().checkForUpdates());

    expect(descriptions(toast.info)).toContain('updater.downloading');
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'updater.failed',
      expect.objectContaining({
        id: TOAST_ID,
        description: expect.stringMatching(/simulated/i)
      })
    );
    expect(commands()).toEqual([]);
  });

  it('leaves the real updater alone the moment every switch is off', async () => {
    const sim = useSimulationStore();
    sim.set(SIM_UPDATE_AVAILABLE, true);
    sim.disableAll();
    invoke.mockResolvedValue(null);
    await useUpdater().checkForUpdates();
    expect(commands()).toEqual(['check_update']);
  });
});

describe('useUpdater against the real updater', () => {
  it('installs what the check offers and renders the backend progress', async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'check_update') return '1.2.3';
      if (cmd === 'install_update') {
        emitProgress?.({ percent: 42, done: false });
        emitProgress?.({ percent: 100, done: true });
      }
      return null;
    });
    await useUpdater().checkForUpdates();

    expect(commands()).toEqual(['check_update', 'install_update']);
    // 42% renders as a percentage; the installer phase has none, so it falls
    // back to the indeterminate wording rather than sitting at 100%.
    expect(descriptions(toast.info)).toEqual([
      'updater.installing',
      'updater.downloading',
      'updater.installing'
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      'updater.installed',
      expect.objectContaining({ id: TOAST_ID })
    );
    // The listener is for one install only.
    expect(unlisten).toHaveBeenCalled();
  });

  it('restarts only when the user takes the offer', async () => {
    invoke.mockImplementation(async (cmd) =>
      cmd === 'check_update' ? '1.2.3' : null
    );
    await useUpdater().checkForUpdates();
    expect(commands()).not.toContain('restart_app');
    await takeRestartOffer();
    expect(commands()).toContain('restart_app');
  });

  it('stays silent outside the desktop shell', async () => {
    isTauriProbe.mockReturnValue(false);
    await useUpdater().checkForUpdates();
    expect(commands()).toEqual([]);
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('says nothing on an automatic check that finds no update', async () => {
    invoke.mockResolvedValue(null);
    await useUpdater().checkForUpdates(false);
    expect(commands()).toEqual(['check_update']);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
