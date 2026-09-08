// App auto-update, channel-aware. Goes through the Rust `check_update` /
// `install_update` commands (not the JS updater) so the active release channel
// can pick the manifest endpoint at runtime — the JS check() can only read the
// static config endpoints. Actual fetching works once the updater is configured
// with a real signing key + a published release for the channel.
//
// Everything the updater does goes through one small backend interface, and the
// developer Simulation page swaps the whole of it for a simulated backend that
// holds no IPC at all (`app/utils/updaterSimulation.ts`). The two are never
// mixed: a simulated state has no route to a real download, install or restart,
// and a production build — where no switch can be on, because the page that
// flips them is behind dev mode and the store is session-only — runs exactly the
// path it ran before.
import { listen } from '@tauri-apps/api/event';
import { toast } from 'vue-sonner';
import type { UpdaterBackend } from '~/utils/updaterSimulation';

/** One step of a download, as the Rust `install_update` emits it. */
interface UpdateProgress {
  /** Whole percent, or null when the download announced no length. */
  percent: number | null;
  /** The bytes are in; the installer itself is now running. */
  done: boolean;
}

const PROGRESS_EVENT = 'update-progress';

/**
 * One id for a whole check-and-install run, so the toast is *updated* rather
 * than replaced: "installing", then each percent, then the outcome, all in the
 * same place. A modal progress dialog was rejected as too heavy for something
 * that can happily run in the background.
 */
const TOAST_ID = 'app-update';

/** How long a terminal (failed) update toast stays up. */
const OUTCOME_MS = 8000;

export function useUpdater() {
  const { t } = useI18n();
  const settings = useSettingsStore();
  const simulation = useSimulationStore();
  const { version, experiment } = useAppVersion();
  const checking = ref(false);

  // The real updater: the two Rust commands plus the restart they make
  // necessary. The progress listener is attached for the length of one install
  // and dropped again — there is nothing to report outside one.
  const realUpdater: UpdaterBackend = {
    check: (channel, force) =>
      tauriInvoke<string | null>({
        command: 'check_update',
        args: { channel, force },
        fallback: null
      }),
    async install(channel, force, onProgress) {
      const stop = isTauri()
        ? await listen<UpdateProgress>(PROGRESS_EVENT, (e) =>
            // `done` means the download finished and the installer took over,
            // which has no percentage of its own.
            onProgress(e.payload.done ? null : e.payload.percent)
          )
        : undefined;
      try {
        await tauriInvoke<null>({
          command: 'install_update',
          args: { channel, force },
          fallback: null
        });
      } finally {
        stop?.();
      }
    },
    async restart() {
      await tauriInvoke<null>({ command: 'restart_app', fallback: null });
    }
  };

  // Offered after an install, never performed automatically: glimpse holds
  // unfinished commit messages and conflict resolutions, and an app that
  // vanishes mid-merge destroys work. Under a simulation nothing restarts —
  // the simulated backend has no restart in it to call — so say so rather than
  // leave the button looking dead.
  async function restart(backend: UpdaterBackend, simulating: boolean) {
    if (simulating) {
      toast.info(t('updater.restartSimulated'));
      return;
    }
    try {
      await backend.restart();
    } catch (err) {
      toast.error(t('updater.restartFailed'), { description: String(err) });
      console.error('restart failed:', err);
    }
  }

  // The channel string the Rust updater expects. For experiments it carries the
  // selected slug (`experiment:<slug>`) so it hits that experiment's manifest.
  function effectiveChannel(): string {
    if (settings.releaseChannel === 'experiment') {
      return settings.selectedExperiment
        ? `experiment:${settings.selectedExperiment}`
        : '';
    }
    return settings.releaseChannel;
  }

  // Which channel the running build belongs to, inferred from its version.
  function runningChannel(): 'stable' | 'beta' | 'experiment' {
    if (experiment.value) return 'experiment';
    if (version.value.includes('-beta.')) return 'beta';
    return 'stable';
  }

  async function checkForUpdates(manual = true) {
    const simulated = simulatedUpdater((id) => simulation.isOn(id));
    // Outside the desktop shell there is no updater to talk to. A simulation is
    // pure frontend, though, so it still runs — which is what makes the progress
    // and restart flow walkable in the browser demo as well as in the app.
    if (!simulated && !isTauri()) return;
    const backend = simulated ?? realUpdater;
    const channel = effectiveChannel();
    // Experiment channel with nothing picked yet — nothing to check.
    if (!channel) {
      if (manual) toast.error(t('updater.noExperiment'));
      return;
    }
    // Switching channels (a manual check where the selected channel differs from
    // the running build's) installs that channel's current build even if it
    // isn't strictly newer — e.g. beta → the latest stable, a deliberate
    // downgrade. Automatic launch checks never force, so they can't downgrade.
    const force = manual && runningChannel() !== settings.releaseChannel;
    checking.value = true;
    // Once the in-place toast is up every outcome has to land in it: an
    // automatic check that failed silently would otherwise leave a progress
    // toast turning forever.
    let showing = false;
    try {
      const available = await backend.check(channel, force);
      if (!available) {
        if (manual) toast.success(t('updater.upToDate'));
        return;
      }
      const title = t('updater.available', { version: available });
      const progress = (percent: number | null) => {
        showing = true;
        toast.info(title, {
          id: TOAST_ID,
          description:
            percent === null
              ? t('updater.installing')
              : t('updater.downloading', { percent }),
          duration: Infinity
        });
      };
      // The download reports as it goes; until the first chunk lands there is
      // nothing to show but "installing…", which is where this started.
      progress(null);
      await backend.install(channel, force, progress);
      toast.success(t('updater.installed'), {
        id: TOAST_ID,
        description: t('updater.restartHint'),
        // The one toast worth leaving up: it asks a question, and an update that
        // installed but never runs is exactly the gap this closes.
        duration: Infinity,
        action: {
          label: t('updater.restart'),
          onClick: () => void restart(backend, simulated !== null)
        }
      });
    } catch (err) {
      if (manual || showing) {
        toast.error(t('updater.failed'), {
          id: TOAST_ID,
          description: String(err),
          duration: OUTCOME_MS
        });
      }
      console.error('update check failed:', err);
    } finally {
      checking.value = false;
    }
  }

  return { checking, checkForUpdates };
}
