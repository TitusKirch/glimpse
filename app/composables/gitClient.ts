// Typed git client — one method per backend command. This is the single place
// that knows the IPC command strings, their argument shapes, and their dev-mode
// fallbacks. The store calls intent-named methods; nothing else restates the
// stringly-typed `invoke`. Payload types come from the generated bindings
// (see app/types/bindings.ts), so the contract has one source of truth.
//
// Methods that take more than a repo path use a single options object (rather
// than positional args) so call sites stay readable and order-independent.

import { invoke } from '@tauri-apps/api/core';
import type {
  BlameLine,
  Commit,
  CommitFile,
  DiffData,
  RepoInfo,
  StatusEntry
} from '~/types/bindings';

// Thin bridge to the Tauri backend: inside the desktop shell it invokes Rust
// commands over IPC; in the browser (Nuxt dev demo) it returns the given
// fallback so the UI is fully developable without the native shell. Private to
// the client — nothing else should restate the stringly-typed `invoke`.
async function gitInvoke<T>({
  command,
  args,
  fallback
}: {
  command: string;
  args?: Record<string, unknown>;
  fallback?: T;
}): Promise<T> {
  if (isTauri()) {
    return invoke<T>(command, args);
  }
  if (fallback !== undefined) return fallback;
  throw new Error(
    `gitInvoke(${command}) called outside Tauri without a fallback`
  );
}

// Each method owns its command name, arg shape, and fallback. Read methods fall
// back to mock data so the browser demo renders; mutations fall back to a no-op.
export const gitClient = {
  defaultRepo: () =>
    gitInvoke<string>({ command: 'default_repo', args: {}, fallback: '.' }),

  // Start the FS watcher for `path`; the backend emits `repo-changed`.
  watchRepo: (path: string) =>
    gitInvoke<null>({ command: 'watch_repo', args: { path }, fallback: null }),

  // No fallback: in the browser this rejects and the caller keeps mock state.
  info: (path: string) =>
    gitInvoke<RepoInfo>({ command: 'repo_info', args: { path } }),

  log: ({ path, limit = 100 }: { path: string; limit?: number }) =>
    gitInvoke<Commit[]>({
      command: 'git_log',
      args: { path, limit },
      fallback: []
    }),

  status: (path: string) =>
    gitInvoke<StatusEntry[]>({
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
    gitInvoke<DiffData | null>({
      command: 'file_diff',
      args: { path, file, staged, ignoreWhitespace, whole },
      fallback: gitMock.diff
    }),

  // Commits that touched a file (follows renames).
  fileHistory: ({ path, file }: { path: string; file: string }) =>
    gitInvoke<Commit[]>({
      command: 'file_history',
      args: { path, file },
      fallback: []
    }),

  // Per-line authorship for a file.
  blame: ({ path, file }: { path: string; file: string }) =>
    gitInvoke<BlameLine[]>({
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
    gitInvoke<null>({
      command: 'apply_hunk',
      args: { path, file, hunk, reverse },
      fallback: null
    }),

  commitBody: ({ path, hash }: { path: string; hash: string }) =>
    gitInvoke<string>({
      command: 'commit_body',
      args: { path, hash },
      fallback: ''
    }),

  commitFiles: ({ path, hash }: { path: string; hash: string }) =>
    gitInvoke<CommitFile[]>({
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
    gitInvoke<DiffData | null>({
      command: 'commit_file_diff',
      args: { path, hash, file, ignoreWhitespace, whole },
      fallback: gitMock.diff
    }),

  stage: ({ path, file }: { path: string; file: string }) =>
    gitInvoke<null>({ command: 'stage', args: { path, file }, fallback: null }),

  unstage: ({ path, file }: { path: string; file: string }) =>
    gitInvoke<null>({
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
    gitInvoke<string>({
      command: 'commit',
      args: { path, message, amend },
      fallback: ''
    }),

  // Subject + body of HEAD, used to prefill an amend.
  headMessage: (path: string) =>
    gitInvoke<string>({
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
    gitInvoke<null>({
      command: 'discard',
      args: { path, file, untracked },
      fallback: null
    }),

  checkoutBranch: ({ path, branch }: { path: string; branch: string }) =>
    gitInvoke<null>({
      command: 'checkout_branch',
      args: { path, branch },
      fallback: null
    }),

  merge: ({ path, branch }: { path: string; branch: string }) =>
    gitInvoke<string>({
      command: 'merge',
      args: { path, branch },
      fallback: ''
    }),

  discardAll: (path: string) =>
    gitInvoke<null>({ command: 'discard_all', args: { path }, fallback: null }),

  checkoutCommit: ({ path, hash }: { path: string; hash: string }) =>
    gitInvoke<null>({
      command: 'checkout_commit',
      args: { path, hash },
      fallback: null
    }),

  createBranch: ({ path, name }: { path: string; name: string }) =>
    gitInvoke<null>({
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
    gitInvoke<null>({
      command: 'create_branch_at',
      args: { path, name, hash },
      fallback: null
    }),

  deleteBranch: ({ path, name }: { path: string; name: string }) =>
    gitInvoke<null>({
      command: 'delete_branch',
      args: { path, name },
      fallback: null
    }),

  revert: ({ path, hash }: { path: string; hash: string }) =>
    gitInvoke<null>({
      command: 'revert',
      args: { path, hash },
      fallback: null
    }),

  cherryPick: ({ path, hash }: { path: string; hash: string }) =>
    gitInvoke<null>({
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
    gitInvoke<null>({
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
    gitInvoke<null>({
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
    gitInvoke<null>({
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
    gitInvoke<null>({
      command: 'create_tag',
      args: { path, name, hash },
      fallback: null
    }),

  deleteTag: ({ path, name }: { path: string; name: string }) =>
    gitInvoke<null>({
      command: 'delete_tag',
      args: { path, name },
      fallback: null
    }),

  pushTags: (path: string) =>
    gitInvoke<string>({ command: 'push_tags', args: { path }, fallback: '' }),

  addRemote: ({
    path,
    name,
    url
  }: {
    path: string;
    name: string;
    url: string;
  }) =>
    gitInvoke<null>({
      command: 'add_remote',
      args: { path, name, url },
      fallback: null
    }),

  removeRemote: ({ path, name }: { path: string; name: string }) =>
    gitInvoke<null>({
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
    gitInvoke<null>({
      command: 'rename_remote',
      args: { path, old: oldName, new: newName },
      fallback: null
    }),

  stashSave: ({ path, message = '' }: { path: string; message?: string }) =>
    gitInvoke<null>({
      command: 'stash_save',
      args: { path, message },
      fallback: null
    }),

  stashPop: ({ path, reference }: { path: string; reference: string }) =>
    gitInvoke<null>({
      command: 'stash_pop',
      args: { path, reference },
      fallback: null
    }),

  stashApply: ({ path, reference }: { path: string; reference: string }) =>
    gitInvoke<null>({
      command: 'stash_apply',
      args: { path, reference },
      fallback: null
    }),

  stashDrop: ({ path, reference }: { path: string; reference: string }) =>
    gitInvoke<null>({
      command: 'stash_drop',
      args: { path, reference },
      fallback: null
    }),

  fetch: (path: string) =>
    gitInvoke<string>({ command: 'fetch', args: { path }, fallback: '' }),

  pull: ({ path, rebase = false }: { path: string; rebase?: boolean }) =>
    gitInvoke<string>({
      command: 'pull',
      args: { path, rebase },
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
    gitInvoke<string>({
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
    gitInvoke<null>({
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
    gitInvoke<null>({ command: 'open_in', args: { path, app }, fallback: null })
};
