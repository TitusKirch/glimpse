# CONTEXT

Domain vocabulary for `glimpse` — the nouns and verbs the code is named after.
Keep these terms exact in code, comments, and discussion so a reader (human or
agent) can map a name to its concept without re-deriving it. This file is the
domain glossary; the architecture vocabulary (module, interface, seam, depth,
leverage, locality) lives in the review tooling, not here.

## Terms

**RepoState**
Everything one open repository shows in a tab: its identity (`id`, `name`,
`path`, `flavor`, `distro`) plus its whole view — branches, remote branches,
current branch, remotes, tags, stashes, commits, working-tree status, and the
current selection/diff. The repo store keeps these keyed by `id` with an
`activeId`; projection getters expose the active one so switching tabs swaps the
entire graph + diff.

**selection**
What the diff panel is showing for the active repo: either a **commit** is
selected (its body + changed files) or a working-tree **file** is selected
(staged or unstaged). The two are mutually exclusive. Today the panels read the
underlying fields (`selectedHash`, `selectedBody`, `selectedFile`,
`selectedFileStaged`, `commitFiles`) directly — flat projections, because most
readers want one field (which commit row is highlighted, which file to blame),
not the whole pair. After a reload the restore-or-default decision — keep the
previous commit/file when it still exists, else a sensible default — lives in the
pure `restoreSelection` strategy (`app/utils/selectionRestore.ts`), returning a
`SelectionTarget` the store applies; that keeps the mutual-exclusion logic
testable without running the whole `loadFromBackend`.

**native**
The single Native/Browser gate for repo-store effects. A store action wraps its
body in `native(fn)`: inside the Tauri desktop shell it runs `fn`; in the
browser demo it is a no-op so the mock data stays put and no git dialog appears.
The `isTauri()` check lives here once instead of being restated at each action.

**mutate**
The repo store's shared mutating-action shape: go through `native` (skip outside
the desktop shell), run the git call under `guarded` (busy flag + error
surfacing), then refresh the view — `reload` (re-read the whole repo), `status`
(working tree + current diff), or `none` (the action updates the view itself).

**GitTarget / resolve**
How `git` is reached for a repository, decided once per repo by
`platform::resolve()`: native git by default, or — on Windows only, for a
`\\wsl$` / `\\wsl.localhost` path — the distro's git via
`wsl.exe -d <distro> --cd <linux-path> --exec git`. A `Repo` holds one resolved
`GitTarget`, so the platform seam is touched in exactly one place. An explicit
`glimpse.target` (`native` or a git binary path) overrides the automatic
decision; resolve reads it from the git config _files_ in git's precedence order
(system → XDG → `~/.gitconfig` → repo-local, later wins) via one reader —
`resolve` runs before any git is chosen, so it can't shell out to `git config`
the way the IPC `get_config` does.

**ResetMode**
The `git reset` variant: `soft`, `mixed`, or `hard`. A serde enum on the Rust
side, deserialized from the frontend's `'soft' | 'mixed' | 'hard'` union, so an
unknown value is rejected at the IPC seam instead of silently falling back to
`--mixed`.

**diffLang**
Maps a file name's extension to a highlight.js language id (or `''` when the
extension is unknown or that grammar isn't loaded), gated by `hljs.getLanguage`.
The single source of truth for syntax highlighting across both the diff and
blame views (`app/utils/highlight.ts`); `parseDiff` consumes it rather than
keeping its own copy.

**gitConfig**
The mechanism for reading/writing a git config key at a scope through the active
repo's git (or the default repo when none is open). Owns the routing path and the
_inherit_ rule: at `local` scope an empty value clears the key (so the global
value is inherited again), at `global` scope an empty value is left untouched
(never wipe the global identity). The settings components keep their own UI state
and i18n toasts; the load/save/inherit round-trips live once in `useGitConfig`
(`app/composables/useGitConfig.ts`). A boolean override is three-valued in the UI
— Inherit / On / Off — converted to/from the config string by `toTriState` /
`triStateConfig` (`app/utils/triState.ts`).

**repoOverride**
The per-repo git override policy: the set of local keys an override owns
(`REPO_OVERRIDE_KEYS`), the `glimpse.override` flag that records "this repo is
customised", and the effective scope a per-repo-aware write lands in. One home
(`app/composables/useRepoOverride.ts`) — RepositoryPage's master switch, the
commit box and the `gitConfig` conventional-commits writer consult it instead of
restating the key list or re-reading the flag. Turning the override off clears the
flag and every key in the set, so the repo falls back to global.

**recent list / moveToFront**
A persisted, most-recent-first, de-duplicated, capped list — used for recently
opened repositories and recently used command-palette actions. The mechanics
(move/insert to front, dedup by a stable key, trim to `max`) live once in the
pure `moveToFront` core (`app/utils/recency.ts`); each store supplies the key and
the cap (owned by the layout store, under Settings → General → Recent).

**diagnostics**
The facts a bug report needs about the running app — version and build kind,
release channel and experiment slug, OS, WebView, the git that actually runs,
and the route — plus the markdown they paste as. One format
(`app/utils/diagnostics.ts`), one assembly (`useDiagnostics()`), two surfaces:
the fatal error page (`app/error.vue`) adds the error's status/message/stack,
Settings → Diagnostics adds what only a working app shell can reach (channel,
experiment, `git --version`, the resolved target). Every field either surface
cannot answer is optional and simply omitted, so the two produce the same block
rather than two dialects of one. The assembly inherits the error page's rules —
no store, no i18n, no shadcn component, IPC only as enrichment — because it runs
on the page that shows _because_ the app shell broke; `error.vue` calls it in a
try/catch and falls back to computing the facts inline.

**simulation**
A developer switch that deliberately bends how the running app behaves — make
IPC fail, pretend an update is available. The opposite of a _diagnostic_, which
only observes; that split is the axis the Developer settings group is ordered
along (Showcase → Triggers → Diagnostics → Simulation,
`app/utils/developerPages.ts`). Simulations are **session-only**: the store
(`app/stores/simulation.ts`) is the one that is deliberately not persisted, so a
switch can never greet someone after a restart and a forgotten switch can never
be reported as a real bug. While any is active it is announced app-wide in the
sidebar badge slot, alongside (never instead of) the EXPERIMENT / BETA build
identity — build identity and runtime state say different things. The detailed
list and the single "turn everything off" live on the Simulation page.

**UpdaterBackend**
The updater as `useUpdater` uses it: `check`, `install` (reporting whole
percents) and the `restart` offered afterwards. One shape with two
implementations — the real one over the Rust `check_update` / `install_update` /
`restart_app` commands, and a simulated one built from the Simulation page's
switches (`app/utils/updaterSimulation.ts`). The composable picks **one** per run
and never mixes them, which is what makes "a simulated update can never start a
real download, install or restart" structural rather than a guard: the simulated
backend holds no IPC to reach one with. Progress arrives as an `update-progress`
event and updates a single toast in place; the restart at the end is _offered_,
never taken automatically, because glimpse holds unfinished commit messages and
conflict resolutions and an app that vanishes mid-merge destroys work.

**trigger**
A developer control that fires a one-off action so a surface can be looked at on
purpose — a toast, one of the promise dialogs, or a deliberate crash. The
opposite of a _simulation_, which stays on and bends the app until it is switched
off; that split is the axis the Developer settings group is ordered along. The
**crash** triggers are the one group that ends the current session, so each says
what it is about to do and waits for a confirmation; they exist because the fatal
error page and the diagnostics block it renders otherwise only show once
something has already gone wrong. What they provoke is routed app-wide by
`app/plugins/errors.client.ts`, by how much of the app is left standing: an error
out of render, a watcher or an event handler hands over to `app/error.vue`, while
an unhandled promise rejection is only an error toast, because the rendered app
still works. The backend trigger is the Rust `dev_panic` command — compiled into
release builds the way `open_devtools` is, and reachable only from the Developer
pages `devMode` unlocks.
