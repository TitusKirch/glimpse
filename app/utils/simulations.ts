// The git fault switches the developer Simulation page offers, and the ids they
// are registered under in the simulation store.
//
// The store is deliberately a registry rather than a fixed set of fields, so the
// tool that flips a switch owns the id it registers. These are that tool's: two
// ways of bending the one thing glimpse is built on — the git subprocess — so
// the loading and error paths can be walked deliberately instead of by breaking
// a repository on purpose.
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
