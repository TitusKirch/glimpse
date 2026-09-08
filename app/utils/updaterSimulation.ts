// What the Simulation page's updater switches actually do.
//
// The updater is a shipping mechanism, so the one thing this module must never
// hold is a route to a real one: there is no `tauriInvoke` here, no Tauri import,
// nothing that crosses the IPC seam. A simulated state therefore cannot start a
// real download, install or restart — not because a guard remembered to say so,
// but because there is nothing here to reach one with. `useUpdater` picks either
// this backend or the real one and never mixes them, which is what keeps a
// production build's verify-and-install path untouched by any of this.

import {
  SIM_UPDATE_CHECK_FAILED,
  SIM_UPDATE_DOWNLOAD_FAILED,
  UPDATER_SIMULATIONS
} from './simulations';

/**
 * The updater as `useUpdater` uses it: check, install, and the restart offered
 * afterwards. One shape for both the real (IPC) and the simulated backend, so
 * choosing between them is a single assignment rather than a branch per call.
 */
export interface UpdaterBackend {
  /** The version on offer for `channel`, or null when there is none. */
  check(channel: string, force: boolean): Promise<string | null>;
  /**
   * Download and install it, reporting whole percents as it goes. `null` means
   * the download announced no length, so there is no percentage to show.
   */
  install(
    channel: string,
    force: boolean,
    onProgress: (percent: number | null) => void
  ): Promise<void>;
  /** Restart into the installed version. */
  restart(): Promise<void>;
}

/**
 * The version a simulated check offers. Deliberately absurd and marked as a
 * simulation, so a screenshot of the toast can never be mistaken for a real
 * release and it can never outrank one.
 */
export const SIMULATED_VERSION = '99.0.0-simulated';

/** Percent per reported step, and how long a step takes. */
const STEP_PERCENT = 5;
const STEP_MS = 120;

/** Where a simulated download gives up — part-way, never at a complete one. */
const FAIL_PERCENT = 40;

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Shaped like the app's other simulated failures: says plainly that it is one. */
function simulatedError(what: string): Error {
  return new Error(`glimpse: simulated ${what}`);
}

/**
 * The simulated updater for whichever switches are on, or `null` when none of
 * them is — in which case the caller uses the real updater, exactly as before.
 *
 * `sleep` is injected because the pace is the point: a ramp fast enough to be
 * instant would demonstrate nothing, and a test that waited for a slow one would
 * only be measuring `setTimeout`.
 */
export function simulatedUpdater(
  isOn: (id: string) => boolean,
  sleep: (ms: number) => Promise<void> = realSleep
): UpdaterBackend | null {
  if (!UPDATER_SIMULATIONS.some((id) => isOn(id))) return null;
  return {
    async check() {
      if (isOn(SIM_UPDATE_CHECK_FAILED)) throw simulatedError('update check');
      return SIMULATED_VERSION;
    },
    async install(_channel, _force, onProgress) {
      const failing = isOn(SIM_UPDATE_DOWNLOAD_FAILED);
      const last = failing ? FAIL_PERCENT : 100;
      for (let percent = 0; percent <= last; percent += STEP_PERCENT) {
        onProgress(percent);
        await sleep(STEP_MS);
      }
      if (failing) throw simulatedError('update download');
    },
    async restart() {
      // Nothing: a simulation may never restart the app. The caller says so to
      // the user; this is what makes it true.
    }
  };
}
