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
  RepoInfo,
  StatusEntry
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

  log: ({ path, limit = 100 }: { path: string; limit?: number }) =>
    tauriInvoke<Commit[]>({
      command: 'git_log',
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

  revert: ({ path, hash }: { path: string; hash: string }) =>
    tauriInvoke<null>({
      command: 'revert',
      args: { path, hash },
      fallback: null
    }),

  cherryPick: ({ path, hash }: { path: string; hash: string }) =>
    tauriInvoke<null>({
      command: 'cherry_pick',
      args: { path, hash },
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

  stashSave: ({ path, message = '' }: { path: string; message?: string }) =>
    tauriInvoke<null>({
      command: 'stash_save',
      args: { path, message },
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
