// What one open repository *is*, and the pure helpers that shape it.
//
// Multi-repo: each open repository is one RepoState (its identity + its whole
// view — branches, commits, status, diff, selection). `repo.ts` keeps them
// keyed by id with an activeId and projects the active one through getters, so
// switching tabs swaps the entire graph + diff.
//
// Nothing here reaches git or Pinia: it is the vocabulary the action modules in
// this directory share, which is why it sits at the bottom of the tree and
// imports none of them.
import { z } from 'zod';
import type {
  Branch,
  Commit,
  CommitFile,
  DiffData,
  StashEntry,
  StatusEntry
} from '~/types/bindings';

// Keep loading spinners visible for at least this long so fast actions don't
// flicker.
export const MIN_SPINNER_MS = 300;

// One page of history. A tab opens at one page and "load more history" adds
// another.
export const LOG_PAGE = 200;

// How many tabs keep their loaded data — the active tab plus the three most
// recently used. Without a cap, memory tracks the tabs left open rather than the
// tabs in use: ten open tabs hold ten full commit lists and ten full diffs
// whether or not the user has looked at nine of them since launch. The cap sits
// deliberately above the pair or trio a user actually alternates between,
// because the price of releasing a tab is a reload the user can feel.
export const MAX_LOADED_TABS = 4;

// Monotonic activation stamps, used to pick the least recently used tabs. A
// counter rather than a clock: two tab switches inside the same millisecond
// would tie on Date.now(), and a tie is settled by whichever tab the sort
// happens to look at first — so the wrong tab would lose its data.
let activations = 0;
export function nextActivation(): number {
  activations += 1;
  return activations;
}

// Frontend-only types (no backend counterpart).
export type GitFlavor = 'windows' | 'wsl' | 'linux' | 'macos';
export type DiffMode = 'split' | 'unified' | 'whole';

// Everything one open repository shows. The tab strip renders id/name/flavor;
// the panels read the rest of the active repo via projection getters.
export interface RepoState {
  id: string;
  name: string;
  path: string;
  flavor: GitFlavor;
  distro?: string;
  branches: Branch[];
  remoteBranches: string[];
  currentBranch: string;
  remotes: string[];
  tags: string[];
  stashes: StashEntry[];
  // The bulk payloads. Each is a snapshot: the store replaces it wholesale
  // (`r.status = ...`) and never edits an entry in place, so `status`,
  // `commitFiles` and `diff` are stored through markRaw. Deeply reactive, Vue
  // gives every status entry, file row and diff object its own proxy and
  // dependency map — per-object overhead that grows with the working tree and
  // the size of a diff, and that nothing reads back, since every reader tracks
  // replacement. Replacing the property still notifies (the property lives on
  // the reactive repo; only its value is opaque), so the one rule is that a
  // change must assign a fresh value — mutating an entry in place would leave
  // the view showing the old one. `commits` is the same kind of snapshot and
  // wants the same treatment; its one assignment sits in `loadLog`.
  commits: Commit[];
  status: StatusEntry[];
  selectedHash: string | null;
  selectedBody: string;
  selectedFile: string | null;
  selectedFileStaged: boolean;
  commitFiles: CommitFile[];
  diff: DiffData | null;
  // How many commits this tab loads, raised a page at a time by "load more
  // history". It belongs to the tab because it drives a per-tab fetch: as
  // app-wide state, asking for depth in one repository raised what every other
  // open tab fetched on its next load, so the retained commits — and the graph
  // nodes drawn from them — cost the raised limit times the number of open
  // tabs. Living here it also expires with the tab: closing one takes its depth
  // with it, so a reopened tab walks back through history from one page rather
  // than resurrecting a depth the user has shut away.
  logLimit: number;
  // Whether this tab's last log fetch hit its limit, i.e. more history exists
  // behind it. Stored rather than derived so it doesn't flip false mid-load and
  // hide the button. It belongs to the tab for the same reason `logLimit` does:
  // a load takes a target, so a background repo's log — a watcher event, a
  // window-focus refresh — answered the question for whichever tab the user was
  // looking at, and a shallow repository loading behind the scenes hid the
  // "load more history" button of a tab that genuinely had more.
  hasMore: boolean;
  // The message from this tab's last failed load, cleared when it loads again —
  // drives the inline error panel and its Retry. Per tab because the load that
  // sets it writes everything else into its target: as app-wide state a failure
  // painted its panel over whichever tab was active, so the failure was
  // invisible where it happened and the Retry button reloaded a repository that
  // was fine. A tab closed mid-load takes its error with it, the request
  // withdrawn.
  loadError: string | null;
  // Activation stamp: a monotonic counter, higher meaning more recently
  // activated. It decides which tabs keep their data when more are open than
  // MAX_LOADED_TABS covers.
  lastActive: number;
  // False until this tab's git data has been fetched. Restored tabs start as
  // unloaded placeholders and lazy-load on first activation.
  loaded: boolean;
  // True while the tab's platform (flavor/distro) is being probed — drives the
  // tab-icon spinner so a WSL tab shows a spinner, never the wrong-distro
  // penguin, until its real distro is known (resolved in the background for
  // placeholders that haven't been activated yet).
  resolving: boolean;
  // True while a rebase is paused (e.g. on a conflict) — drives the rebase
  // banner with continue / skip / abort.
  rebaseInProgress: boolean;
  // True while a bisect session is active — drives the bisect banner.
  bisectInProgress: boolean;
}

// Demo repository shown in the browser (no Tauri shell).
export function demoRepo(): RepoState {
  return {
    id: 'r1',
    name: 'glimpse',
    path: '\\\\wsl$\\Ubuntu-22.04\\home\\titus\\glimpse',
    flavor: 'wsl',
    distro: 'Ubuntu-22.04',
    branches: [
      { name: 'main', ahead: 0, behind: 0, published: true },
      { name: 'dev', ahead: 2, behind: 0, published: true },
      // Unpublished on purpose: it is the only branch here that exercises the
      // sidebar's "not published" marker in browser demo mode.
      { name: 'feat/wsl', ahead: 1, behind: 3, published: false }
    ],
    remoteBranches: ['origin/main', 'origin/dev'],
    currentBranch: 'main',
    remotes: ['origin'],
    tags: ['v0.0.0'],
    stashes: [],
    commits: gitMock.commits,
    status: gitMock.status,
    selectedHash: null,
    selectedBody: '',
    selectedFile: 'app/stores/repo.ts',
    selectedFileStaged: false,
    commitFiles: [],
    diff: gitMock.diff,
    logLimit: LOG_PAGE,
    hasMore: false,
    loadError: null,
    // A tab is created active, so creating one counts as activating it.
    lastActive: nextActivation(),
    loaded: true,
    resolving: false,
    rebaseInProgress: false,
    bisectInProgress: false
  };
}

// A freshly opened repository before its git data is loaded.
export function blankRepo({
  id,
  path
}: {
  id: string;
  path: string;
}): RepoState {
  return {
    id,
    name: path.split(/[\\/]/).pop() || 'repo',
    path,
    // Guess the flavor from the path so a restored placeholder shows a sensible
    // badge before it loads; corrected from real git output on load.
    flavor: /^[\\/]{2}wsl/i.test(path) ? 'wsl' : 'linux',
    distro: undefined,
    // A WSL placeholder's distro isn't known until probed — spin its icon until
    // then (resolved on activation or in the background) instead of flashing the
    // generic penguin. Non-WSL tabs show no distro icon, so they never spin.
    resolving: /^[\\/]{2}wsl/i.test(path),
    branches: [],
    remoteBranches: [],
    currentBranch: '',
    remotes: [],
    tags: [],
    stashes: [],
    commits: [],
    status: [],
    selectedHash: null,
    selectedBody: '',
    selectedFile: null,
    selectedFileStaged: false,
    commitFiles: [],
    diff: null,
    logLimit: LOG_PAGE,
    hasMore: false,
    loadError: null,
    // A newly opened tab is the most recently used one, so it is never the tab
    // the next release picks — a tab that dropped the data it was opened for
    // would reload it on the spot.
    lastActive: nextActivation(),
    loaded: false,
    rebaseInProgress: false,
    bisectInProgress: false
  };
}

// Tab ids whose platform metadata is being probed in the background, so two
// loads don't both fetch `info` for the same placeholder. An id is claimed for
// the life of its probe and released the moment either end of that comes —
// the probe settling, or the tab going away under it (see `closeRepo`).
export const resolvingPlatform = new Set<string>();

// Whether a platform probe is claimed for `id`. Exposed only so tests can see
// the claim released: the set is otherwise invisible bookkeeping, and a stale
// id in it has no symptom a caller could observe.
export function isResolvingPlatform(id: string): boolean {
  return resolvingPlatform.has(id);
}

// A stash is referenced as `stash@{N}`. It needs stash-specific diff commands —
// being a merge commit, `git show` would yield an unusable combined diff.
export function isStashRef(ref: string): boolean {
  return ref.startsWith('stash@{');
}

// Validate the 1-based mainline parent entered when reverting a merge commit.
export function mainlineSchema(parents: number): z.ZodType<string, string> {
  return z.string().refine(
    (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= parents;
    },
    { message: 'form.validation.mainline' }
  );
}
