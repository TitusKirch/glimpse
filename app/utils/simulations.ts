// The switches the developer Simulation page offers, and the ids they are
// registered under in the simulation store.
//
// The store is deliberately a registry rather than a fixed set of fields, so the
// tool that flips a switch owns the id it registers. This file is where those
// ids are collected, grouped by the mechanism each group bends — which is also
// how the page is sectioned, because what a switch can and cannot reach is the
// thing a reader needs to know before flipping it.

// --- git ---------------------------------------------------------------------
//
// Two ways of bending the one thing glimpse is built on — the git subprocess —
// so the loading and error paths can be walked deliberately instead of by
// breaking a repository on purpose.
//
// Fault injection lives behind the backend's `Repo::run`, which makes its scope
// git *by construction*: the updater, the app version, the CLI status, the
// watcher and the external-open commands keep answering whatever is switched on.
// That is what stops a switch from taking out the route to switching it off. The
// accepted cost is that non-git IPC error paths cannot be rehearsed from here.

/** Every git call fails, with a message shaped like git's own. */
export const SIM_GIT_FAILURE = 'gitFailure';

/** Every git call takes seconds longer than it really does. */
export const SIM_GIT_SLOW = 'gitSlow';

/** The git fault switches, in page order. */
export const GIT_FAULTS = [SIM_GIT_FAILURE, SIM_GIT_SLOW] as const;

// --- updater -----------------------------------------------------------------
//
// The updater's states are otherwise reachable only by publishing a release, so
// the surrounding UI — the progress toast, the restart offer, the failure
// wording — could not be looked at at all without one. These switches produce
// those states in the frontend alone: `useUpdater` swaps its whole backend for
// the simulated one (`app/utils/updaterSimulation.ts`), which holds no IPC, so a
// simulated state has no route to a real download, install or restart.
//
// Unlike the git faults there is nothing to push to the backend, so no plugin
// re-asserts these after a reload — the switch and the code it bends live on the
// same side of the IPC seam, and both are gone together when the webview reloads.

/** An update is on offer, and downloading and installing it succeeds. */
export const SIM_UPDATE_AVAILABLE = 'updateAvailable';

/** The check for an update fails. */
export const SIM_UPDATE_CHECK_FAILED = 'updateCheckFailed';

/** An update is on offer, and downloading it fails part-way. */
export const SIM_UPDATE_DOWNLOAD_FAILED = 'updateDownloadFailed';

/** The updater simulations, in page order. */
export const UPDATER_SIMULATIONS = [
  SIM_UPDATE_AVAILABLE,
  SIM_UPDATE_CHECK_FAILED,
  SIM_UPDATE_DOWNLOAD_FAILED
] as const;

/**
 * The Simulation page's switch sections, in page order. One source of truth: a
 * group added here appears on the page without the page being touched, the same
 * way `DEVELOPER_PAGES` works for the nav.
 */
export const SIMULATION_GROUPS = [
  { key: 'git', ids: GIT_FAULTS },
  { key: 'updater', ids: UPDATER_SIMULATIONS }
] as const;
