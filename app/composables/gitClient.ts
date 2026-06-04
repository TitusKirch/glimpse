// Typed git client — one method per backend command. This is the single place
// that knows the IPC command strings, their argument shapes, and their dev-mode
// fallbacks. The store calls intent-named methods; nothing else restates a
// stringly-typed command. Payload types come from the generated bindings
// (see app/types/bindings.ts), so the contract has one source of truth. Every
// call crosses the shared tauriInvoke seam.
//
// Methods that take more than a repo path use a single options object (rather
// than positional args) so call sites stay readable and order-independent.

import type {
  BlameLine,
  Commit,
  CommitFile,
  DiffData,
  RebaseStep,
  ReflogEntry,
  RepoInfo,
  SparseStatus,
  StatusEntry,
  Submodule,
  Worktree
} from '~/types/bindings';
import type { PullStrategy } from '~/stores/layout';

// Each method owns its command name, arg shape, and fallback. Read methods fall
// back to mock data so the browser demo renders; mutations fall back to a no-op.
export const gitClient = {
  defaultRepo: () =>
    tauriInvoke<string>({ command: 'default_repo', args: {}, fallback: '.' }),

  // Repo path passed on the CLI (`glimpse <path>`) for this launch, consumed
  // once. Null in the browser demo and when no path was given. A trusted, local
  // entry point — unlike a deep link it opens without confirmation.
  takeCliOpenPath: () =>
    tauriInvoke<string | null>({
      command: 'take_cli_open_path',
      args: {},
      fallback: null
    }),

  // Install the `glimpse` command-line launcher onto PATH; resolves to the
  // installed path. No fallback — only ever called from the desktop shell (the
  // settings row that triggers it is hidden in the browser demo).
  installCli: () => tauriInvoke<string>({ command: 'install_cli', args: {} }),

  // The installed launcher path if `glimpse` is already on PATH for this build,
  // else null — lets the settings row show an installed state. Null in the demo.
  cliInstallStatus: () =>
    tauriInvoke<string | null>({
      command: 'cli_install_status',
      args: {},
      fallback: null
    }),

  // Start the FS watcher for `path`; the backend emits `repo-changed`.
  watchRepo: (path: string) =>
    tauriInvoke<null>({
      command: 'watch_repo',
      args: { path },
      fallback: null
    }),

  // No fallback: in the browser this rejects and the caller keeps mock state.
  info: (path: string) =>
    tauriInvoke<RepoInfo>({ command: 'repo_info', args: { path } }),

  // Read a git config value (e.g. `user.name`). `global` reads ~/.gitconfig;
  // empty string means unset. Falls back to empty in the browser demo.
  getConfig: ({
    path,
    key,
    global = true
  }: {
    path: string;
    key: string;
    global?: boolean;
  }) =>
    tauriInvoke<string>({
      command: 'get_config',
      args: { path, key, global },
      fallback: ''
    }),

  // Write a git config value (used for the user's identity).
  setConfig: ({
    path,
    key,
    value,
    global = true
  }: {
    path: string;
    key: string;
    value: string;
    global?: boolean;
  }) =>
    tauriInvoke<null>({
      command: 'set_config',
      args: { path, key, value, global },
      fallback: null
    }),

  // Initialise a new repository in `path` (optional initial branch); resolves to
  // the new repo's toplevel path so the caller can open it.
  initRepo: ({ path, branch }: { path: string; branch?: string }) =>
    tauriInvoke<string>({
      command: 'init_repo',
      args: { path, branch: branch ?? null },
      fallback: ''
    }),

  // Clone `url` into the existing folder `path`; resolves to the new repo's path
  // so the caller can open it.
  cloneRepo: ({ path, url }: { path: string; url: string }) =>
    tauriInvoke<string>({
      command: 'clone_repo',
      args: { path, url },
      fallback: ''
    }),

  log: ({ path, limit = 100 }: { path: string; limit?: number }) =>
    tauriInvoke<Commit[]>({
      command: 'git_log',
      args: { path, limit },
      fallback: []
    }),

  // HEAD reflog entries for the recovery view.
  reflog: ({ path, limit = 100 }: { path: string; limit?: number }) =>
    tauriInvoke<ReflogEntry[]>({
      command: 'reflog',
      args: { path, limit },
      fallback: []
    }),

  status: (path: string) =>
    tauriInvoke<StatusEntry[]>({
      command: 'git_status',
      args: { path },
      fallback: []
    }),

  fileDiff: ({
    path,
    file,
    staged,
    ignoreWhitespace = false,
    whole = false
  }: {
    path: string;
    file: string;
    staged: boolean;
    ignoreWhitespace?: boolean;
    whole?: boolean;
  }) =>
    tauriInvoke<DiffData | null>({
      command: 'file_diff',
      args: { path, file, staged, ignoreWhitespace, whole },
      fallback: gitMock.diff
    }),

  // Commits that touched a file (follows renames).
  fileHistory: ({ path, file }: { path: string; file: string }) =>
    tauriInvoke<Commit[]>({
      command: 'file_history',
      args: { path, file },
      fallback: []
    }),

  // Per-line authorship for a file.
  blame: ({ path, file }: { path: string; file: string }) =>
    tauriInvoke<BlameLine[]>({
      command: 'blame',
      args: { path, file },
      fallback: []
    }),

  // Stage (or unstage with reverse) a single hunk.
  applyHunk: ({
    path,
    file,
    hunk,
    reverse
  }: {
    path: string;
    file: string;
    hunk: string;
    reverse: boolean;
  }) =>
    tauriInvoke<null>({
      command: 'apply_hunk',
      args: { path, file, hunk, reverse },
      fallback: null
    }),

  // Stage (or unstage with reverse) only the selected body-line indices of a
  // single hunk — line-level staging.
  applyLines: ({
    path,
    file,
    hunk,
    lines,
    reverse
  }: {
    path: string;
    file: string;
    hunk: string;
    lines: number[];
    reverse: boolean;
  }) =>
    tauriInvoke<null>({
      command: 'apply_lines',
      args: { path, file, hunk, lines, reverse },
      fallback: null
    }),

  // Discard a single hunk from the working tree (reverse-apply).
  discardHunk: ({
    path,
    file,
    hunk
  }: {
    path: string;
    file: string;
    hunk: string;
  }) =>
    tauriInvoke<null>({
      command: 'discard_hunk',
      args: { path, file, hunk },
      fallback: null
    }),

  commitBody: ({ path, hash }: { path: string; hash: string }) =>
    tauriInvoke<string>({
      command: 'commit_body',
      args: { path, hash },
      fallback: ''
    }),

  commitFiles: ({ path, hash }: { path: string; hash: string }) =>
    tauriInvoke<CommitFile[]>({
      command: 'commit_files',
      args: { path, hash },
      fallback: []
    }),

  commitFileDiff: ({
    path,
    hash,
    file,
    ignoreWhitespace = false,
    whole = false
  }: {
    path: string;
    hash: string;
    file: string;
    ignoreWhitespace?: boolean;
    whole?: boolean;
  }) =>
    tauriInvoke<DiffData | null>({
      command: 'commit_file_diff',
      args: { path, hash, file, ignoreWhitespace, whole },
      fallback: gitMock.diff
    }),

  // Compare two arbitrary refs: changed files + per-file diff.
  compareFiles: ({
    path,
    from,
    to
  }: {
    path: string;
    from: string;
    to: string;
  }) =>
    tauriInvoke<CommitFile[]>({
      command: 'compare_files',
      args: { path, from, to },
      fallback: []
    }),

  compareFileDiff: ({
    path,
    from,
    to,
    file,
    ignoreWhitespace = false,
    whole = false
  }: {
    path: string;
    from: string;
    to: string;
    file: string;
    ignoreWhitespace?: boolean;
    whole?: boolean;
  }) =>
    tauriInvoke<DiffData | null>({
      command: 'compare_file_diff',
      args: { path, from, to, file, ignoreWhitespace, whole },
      fallback: null
    }),

  stage: ({ path, file }: { path: string; file: string }) =>
    tauriInvoke<null>({
      command: 'stage',
      args: { path, file },
      fallback: null
    }),

  unstage: ({ path, file }: { path: string; file: string }) =>
    tauriInvoke<null>({
      command: 'unstage',
      args: { path, file },
      fallback: null
    }),

  commit: ({
    path,
    message,
    amend = false
  }: {
    path: string;
    message: string;
    amend?: boolean;
  }) =>
    tauriInvoke<string>({
      command: 'commit',
      args: { path, message, amend },
      fallback: ''
    }),

  // Subject + body of HEAD, used to prefill an amend.
  headMessage: (path: string) =>
    tauriInvoke<string>({
      command: 'head_message',
      args: { path },
      fallback: ''
    }),

  discard: ({
    path,
    file,
    untracked
  }: {
    path: string;
    file: string;
    untracked: boolean;
  }) =>
    tauriInvoke<null>({
      command: 'discard',
      args: { path, file, untracked },
      fallback: null
    }),

  checkoutBranch: ({ path, branch }: { path: string; branch: string }) =>
    tauriInvoke<null>({
      command: 'checkout_branch',
      args: { path, branch },
      fallback: null
    }),

  merge: ({ path, branch }: { path: string; branch: string }) =>
    tauriInvoke<string>({
      command: 'merge',
      args: { path, branch },
      fallback: ''
    }),

  // Rebase the current branch onto `onto`, and drive a paused rebase.
  rebase: ({ path, onto }: { path: string; onto: string }) =>
    tauriInvoke<string>({
      command: 'rebase',
      args: { path, onto },
      fallback: ''
    }),
  rebaseContinue: (path: string) =>
    tauriInvoke<string>({
      command: 'rebase_continue',
      args: { path },
      fallback: ''
    }),
  rebaseSkip: (path: string) =>
    tauriInvoke<string>({
      command: 'rebase_skip',
      args: { path },
      fallback: ''
    }),
  rebaseAbort: (path: string) =>
    tauriInvoke<null>({
      command: 'rebase_abort',
      args: { path },
      fallback: null
    }),
  // Commits an interactive rebase from `start` would replay (oldest first).
  rebaseCommits: ({ path, start }: { path: string; start: string }) =>
    tauriInvoke<Commit[]>({
      command: 'rebase_commits',
      args: { path, start },
      fallback: []
    }),
  // Run an interactive rebase from a plan; `base` is the parent to replay onto
  // (empty for a root rebase).
  interactiveRebase: ({
    path,
    base,
    steps
  }: {
    path: string;
    base: string;
    steps: RebaseStep[];
  }) =>
    tauriInvoke<string>({
      command: 'interactive_rebase',
      args: { path, base, steps },
      fallback: ''
    }),

  // Bisect: start between bad/good refs, mark each step, reset when done.
  bisectStart: ({
    path,
    bad,
    good
  }: {
    path: string;
    bad: string;
    good: string;
  }) =>
    tauriInvoke<string>({
      command: 'bisect_start',
      args: { path, bad, good },
      fallback: ''
    }),
  bisectMark: ({
    path,
    verdict
  }: {
    path: string;
    verdict: 'good' | 'bad' | 'skip';
  }) =>
    tauriInvoke<string>({
      command: 'bisect_mark',
      args: { path, verdict },
      fallback: ''
    }),
  bisectReset: (path: string) =>
    tauriInvoke<null>({
      command: 'bisect_reset',
      args: { path },
      fallback: null
    }),

  // Worktrees: list, add (optional ref), remove.
  worktrees: (path: string) =>
    tauriInvoke<Worktree[]>({
      command: 'worktrees',
      args: { path },
      fallback: []
    }),
  worktreeAdd: ({
    path,
    wtPath,
    reference
  }: {
    path: string;
    wtPath: string;
    reference: string;
  }) =>
    tauriInvoke<null>({
      command: 'worktree_add',
      args: { path, wtPath, reference },
      fallback: null
    }),
  worktreeRemove: ({ path, wtPath }: { path: string; wtPath: string }) =>
    tauriInvoke<null>({
      command: 'worktree_remove',
      args: { path, wtPath },
      fallback: null
    }),

  // Submodules: list/status, init+update, sync.
  submodules: (path: string) =>
    tauriInvoke<Submodule[]>({
      command: 'submodules',
      args: { path },
      fallback: []
    }),
  submoduleUpdate: (path: string) =>
    tauriInvoke<string>({
      command: 'submodule_update',
      args: { path },
      fallback: ''
    }),
  submoduleSync: (path: string) =>
    tauriInvoke<null>({
      command: 'submodule_sync',
      args: { path },
      fallback: null
    }),

  // Sparse-checkout: status, set included patterns, disable.
  sparseStatus: (path: string) =>
    tauriInvoke<SparseStatus>({
      command: 'sparse_status',
      args: { path },
      fallback: { enabled: false, patterns: [] }
    }),
  sparseSet: ({ path, patterns }: { path: string; patterns: string[] }) =>
    tauriInvoke<null>({
      command: 'sparse_set',
      args: { path, patterns },
      fallback: null
    }),
  sparseDisable: (path: string) =>
    tauriInvoke<null>({
      command: 'sparse_disable',
      args: { path },
      fallback: null
    }),

  discardAll: (path: string) =>
    tauriInvoke<null>({
      command: 'discard_all',
      args: { path },
      fallback: null
    }),

  checkoutCommit: ({ path, hash }: { path: string; hash: string }) =>
    tauriInvoke<null>({
      command: 'checkout_commit',
      args: { path, hash },
      fallback: null
    }),

  createBranch: ({ path, name }: { path: string; name: string }) =>
    tauriInvoke<null>({
      command: 'create_branch',
      args: { path, name },
      fallback: null
    }),

  createBranchAt: ({
    path,
    name,
    hash
  }: {
    path: string;
    name: string;
    hash: string;
  }) =>
    tauriInvoke<null>({
      command: 'create_branch_at',
      args: { path, name, hash },
      fallback: null
    }),

  deleteBranch: ({ path, name }: { path: string; name: string }) =>
    tauriInvoke<null>({
      command: 'delete_branch',
      args: { path, name },
      fallback: null
    }),

  revert: ({
    path,
    hashes,
    mainline
  }: {
    path: string;
    hashes: string[];
    mainline?: number;
  }) =>
    tauriInvoke<null>({
      command: 'revert',
      args: { path, hashes, mainline: mainline ?? null },
      fallback: null
    }),

  cherryPick: ({ path, hashes }: { path: string; hashes: string[] }) =>
    tauriInvoke<null>({
      command: 'cherry_pick',
      args: { path, hashes },
      fallback: null
    }),

  reset: ({
    path,
    hash,
    mode
  }: {
    path: string;
    hash: string;
    mode: 'soft' | 'mixed' | 'hard';
  }) =>
    tauriInvoke<null>({
      command: 'reset',
      args: { path, hash, mode },
      fallback: null
    }),

  renameBranch: ({
    path,
    oldName,
    newName
  }: {
    path: string;
    oldName: string;
    newName: string;
  }) =>
    tauriInvoke<null>({
      command: 'rename_branch',
      args: { path, old: oldName, new: newName },
      fallback: null
    }),

  setUpstream: ({
    path,
    remote,
    branch
  }: {
    path: string;
    remote: string;
    branch: string;
  }) =>
    tauriInvoke<null>({
      command: 'set_upstream',
      args: { path, remote, branch },
      fallback: null
    }),

  createTag: ({
    path,
    name,
    hash = ''
  }: {
    path: string;
    name: string;
    hash?: string;
  }) =>
    tauriInvoke<null>({
      command: 'create_tag',
      args: { path, name, hash },
      fallback: null
    }),

  deleteTag: ({ path, name }: { path: string; name: string }) =>
    tauriInvoke<null>({
      command: 'delete_tag',
      args: { path, name },
      fallback: null
    }),

  pushTags: (path: string) =>
    tauriInvoke<string>({ command: 'push_tags', args: { path }, fallback: '' }),

  addRemote: ({
    path,
    name,
    url
  }: {
    path: string;
    name: string;
    url: string;
  }) =>
    tauriInvoke<null>({
      command: 'add_remote',
      args: { path, name, url },
      fallback: null
    }),

  removeRemote: ({ path, name }: { path: string; name: string }) =>
    tauriInvoke<null>({
      command: 'remove_remote',
      args: { path, name },
      fallback: null
    }),

  renameRemote: ({
    path,
    oldName,
    newName
  }: {
    path: string;
    oldName: string;
    newName: string;
  }) =>
    tauriInvoke<null>({
      command: 'rename_remote',
      args: { path, old: oldName, new: newName },
      fallback: null
    }),

  stashSave: ({
    path,
    message = '',
    includeUntracked = false,
    paths = []
  }: {
    path: string;
    message?: string;
    includeUntracked?: boolean;
    paths?: string[];
  }) =>
    tauriInvoke<null>({
      command: 'stash_save',
      args: { path, message, includeUntracked, paths },
      fallback: null
    }),

  // Files changed by a stash, for the preview before pop/apply.
  stashFiles: ({ path, reference }: { path: string; reference: string }) =>
    tauriInvoke<CommitFile[]>({
      command: 'stash_files',
      args: { path, reference },
      fallback: []
    }),

  // Per-file diff of a stash, for the preview.
  stashFileDiff: ({
    path,
    reference,
    file,
    ignoreWhitespace,
    whole
  }: {
    path: string;
    reference: string;
    file: string;
    ignoreWhitespace: boolean;
    whole: boolean;
  }) =>
    tauriInvoke<DiffData | null>({
      command: 'stash_file_diff',
      args: { path, reference, file, ignoreWhitespace, whole },
      fallback: null
    }),

  stashPop: ({ path, reference }: { path: string; reference: string }) =>
    tauriInvoke<null>({
      command: 'stash_pop',
      args: { path, reference },
      fallback: null
    }),

  stashApply: ({ path, reference }: { path: string; reference: string }) =>
    tauriInvoke<null>({
      command: 'stash_apply',
      args: { path, reference },
      fallback: null
    }),

  stashDrop: ({ path, reference }: { path: string; reference: string }) =>
    tauriInvoke<null>({
      command: 'stash_drop',
      args: { path, reference },
      fallback: null
    }),

  fetch: (path: string) =>
    tauriInvoke<string>({ command: 'fetch', args: { path }, fallback: '' }),

  pull: ({ path, strategy }: { path: string; strategy: PullStrategy }) =>
    tauriInvoke<string>({
      command: 'pull',
      args: { path, strategy },
      fallback: ''
    }),

  push: ({
    path,
    setUpstream = false,
    force = false
  }: {
    path: string;
    setUpstream?: boolean;
    force?: boolean;
  }) =>
    tauriInvoke<string>({
      command: 'push',
      args: { path, setUpstream, force },
      fallback: ''
    }),

  // Resolve a conflicted file ("ours" | "theirs" | "mark").
  resolveConflict: ({
    path,
    file,
    side
  }: {
    path: string;
    file: string;
    side: string;
  }) =>
    tauriInvoke<null>({
      command: 'resolve_conflict',
      args: { path, file, side },
      fallback: null
    }),

  // Open the repo folder in an external app ("files" | "terminal" | "editor").
  openIn: ({
    path,
    app
  }: {
    path: string;
    app: 'files' | 'terminal' | 'editor';
  }) =>
    tauriInvoke<null>({
      command: 'open_in',
      args: { path, app },
      fallback: null
    })
};
