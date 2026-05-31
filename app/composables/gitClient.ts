// Typed git client — one method per backend command. This is the single place
// that knows the IPC command strings, their argument shapes, and their dev-mode
// fallbacks. The store calls intent-named methods; nothing else restates the
// stringly-typed `invoke`. Payload types come from the generated bindings
// (see app/types/bindings.ts), so the contract has one source of truth.

import type {
  Commit,
  CommitFile,
  DiffData,
  RepoInfo,
  StatusEntry
} from '~/types/bindings';

// Demo fixtures shown in the browser (no Tauri shell) so the UI stays
// developable. They live with the client because they ARE its dev fallback.
export const mock = {
  commits: [
    {
      hash: 'a1b2c3d',
      subject: 'feat(diff): side-by-side diff panel',
      author: 'Titus Kirch',
      date: '2026-05-30',
      refs: ['HEAD -> main'],
      parents: ['b2c3d4e'],
      lane: 0
    },
    {
      hash: 'b2c3d4e',
      subject: 'feat(graph): render commit lanes as SVG',
      author: 'Titus Kirch',
      date: '2026-05-29',
      refs: [],
      parents: ['c3d4e5f'],
      lane: 0
    },
    {
      hash: 'c3d4e5f',
      subject: 'feat(wsl): resolve git per repo flavor',
      author: 'Titus Kirch',
      date: '2026-05-29',
      refs: ['origin/main'],
      parents: ['d4e5f60', 'f6a7b80'],
      lane: 0
    },
    {
      hash: 'f6a7b80',
      subject: 'feat(wsl): detect installed distros',
      author: 'Titus Kirch',
      date: '2026-05-28',
      refs: ['feat/wsl'],
      parents: ['d4e5f60'],
      lane: 1
    },
    {
      hash: 'd4e5f60',
      subject: 'chore: scaffold tauri + nuxt shell',
      author: 'Titus Kirch',
      date: '2026-05-28',
      refs: [],
      parents: ['e5f6071'],
      lane: 0
    },
    {
      hash: 'e5f6071',
      subject: 'chore: adapt scaffold template for glimpse',
      author: 'Titus Kirch',
      date: '2026-05-27',
      refs: ['v0.0.0'],
      parents: [],
      lane: 0
    }
  ] satisfies Commit[],
  status: [
    {
      path: 'app/stores/repo.ts',
      x: ' ',
      y: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false
    },
    {
      path: 'src-tauri/src/git.rs',
      x: 'M',
      y: ' ',
      staged: true,
      unstaged: false,
      untracked: false,
      conflicted: false
    },
    {
      path: 'docs/NOTES.md',
      x: '?',
      y: '?',
      staged: false,
      unstaged: false,
      untracked: true,
      conflicted: false
    }
  ] satisfies StatusEntry[],
  diff: {
    fileName: 'app/stores/repo.ts',
    oldContent: '',
    newContent: '',
    hunks: [
      `@@ -1,4 +1,6 @@
 export const useRepoStore = defineStore('repo', {
-  state: () => ({ commits: [] }),
+  state: () => ({ commits: [], status: [] }),
+  // now talks to the real git backend
 })`
    ]
  } satisfies DiffData
};

// Each method owns its command name, arg shape, and fallback. Read methods fall
// back to mock data so the browser demo renders; mutations fall back to a no-op.
export const gitClient = {
  defaultRepo: () => gitInvoke<string>('default_repo', {}, '.'),

  // Start the FS watcher for `path`; the backend emits `repo-changed`.
  watchRepo: (path: string) => gitInvoke<null>('watch_repo', { path }, null),

  // No fallback: in the browser this rejects and the caller keeps mock state.
  info: (path: string) => gitInvoke<RepoInfo>('repo_info', { path }),

  log: (path: string, limit = 100) =>
    gitInvoke<Commit[]>('git_log', { path, limit }, []),

  status: (path: string) =>
    gitInvoke<StatusEntry[]>('git_status', { path }, []),

  fileDiff: (
    path: string,
    file: string,
    staged: boolean,
    ignoreWhitespace = false
  ) =>
    gitInvoke<DiffData | null>(
      'file_diff',
      { path, file, staged, ignoreWhitespace },
      mock.diff
    ),

  // Commits that touched a file (follows renames).
  fileHistory: (path: string, file: string) =>
    gitInvoke<Commit[]>('file_history', { path, file }, []),

  // Stage (or unstage with reverse) a single hunk.
  applyHunk: (path: string, file: string, hunk: string, reverse: boolean) =>
    gitInvoke<null>('apply_hunk', { path, file, hunk, reverse }, null),

  commitBody: (path: string, hash: string) =>
    gitInvoke<string>('commit_body', { path, hash }, ''),

  commitFiles: (path: string, hash: string) =>
    gitInvoke<CommitFile[]>('commit_files', { path, hash }, []),

  commitFileDiff: (
    path: string,
    hash: string,
    file: string,
    ignoreWhitespace = false
  ) =>
    gitInvoke<DiffData | null>(
      'commit_file_diff',
      { path, hash, file, ignoreWhitespace },
      mock.diff
    ),

  stage: (path: string, file: string) =>
    gitInvoke<null>('stage', { path, file }, null),

  unstage: (path: string, file: string) =>
    gitInvoke<null>('unstage', { path, file }, null),

  commit: (path: string, message: string, amend = false) =>
    gitInvoke<string>('commit', { path, message, amend }, ''),

  // Subject + body of HEAD, used to prefill an amend.
  headMessage: (path: string) =>
    gitInvoke<string>('head_message', { path }, ''),

  discard: (path: string, file: string, untracked: boolean) =>
    gitInvoke<null>('discard', { path, file, untracked }, null),

  checkoutBranch: (path: string, branch: string) =>
    gitInvoke<null>('checkout_branch', { path, branch }, null),

  merge: (path: string, branch: string) =>
    gitInvoke<string>('merge', { path, branch }, ''),

  discardAll: (path: string) => gitInvoke<null>('discard_all', { path }, null),

  checkoutCommit: (path: string, hash: string) =>
    gitInvoke<null>('checkout_commit', { path, hash }, null),

  createBranch: (path: string, name: string) =>
    gitInvoke<null>('create_branch', { path, name }, null),

  createBranchAt: (path: string, name: string, hash: string) =>
    gitInvoke<null>('create_branch_at', { path, name, hash }, null),

  deleteBranch: (path: string, name: string) =>
    gitInvoke<null>('delete_branch', { path, name }, null),

  revert: (path: string, hash: string) =>
    gitInvoke<null>('revert', { path, hash }, null),

  cherryPick: (path: string, hash: string) =>
    gitInvoke<null>('cherry_pick', { path, hash }, null),

  reset: (path: string, hash: string, mode: 'soft' | 'mixed' | 'hard') =>
    gitInvoke<null>('reset', { path, hash, mode }, null),

  renameBranch: (path: string, oldName: string, newName: string) =>
    gitInvoke<null>(
      'rename_branch',
      { path, old: oldName, new: newName },
      null
    ),

  createTag: (path: string, name: string, hash = '') =>
    gitInvoke<null>('create_tag', { path, name, hash }, null),

  deleteTag: (path: string, name: string) =>
    gitInvoke<null>('delete_tag', { path, name }, null),

  pushTags: (path: string) => gitInvoke<string>('push_tags', { path }, ''),

  addRemote: (path: string, name: string, url: string) =>
    gitInvoke<null>('add_remote', { path, name, url }, null),

  removeRemote: (path: string, name: string) =>
    gitInvoke<null>('remove_remote', { path, name }, null),

  renameRemote: (path: string, oldName: string, newName: string) =>
    gitInvoke<null>(
      'rename_remote',
      { path, old: oldName, new: newName },
      null
    ),

  stashSave: (path: string, message = '') =>
    gitInvoke<null>('stash_save', { path, message }, null),

  stashPop: (path: string, reference: string) =>
    gitInvoke<null>('stash_pop', { path, reference }, null),

  stashApply: (path: string, reference: string) =>
    gitInvoke<null>('stash_apply', { path, reference }, null),

  stashDrop: (path: string, reference: string) =>
    gitInvoke<null>('stash_drop', { path, reference }, null),

  fetch: (path: string) => gitInvoke<string>('fetch', { path }, ''),
  pull: (path: string, rebase = false) =>
    gitInvoke<string>('pull', { path, rebase }, ''),
  push: (path: string, setUpstream = false, force = false) =>
    gitInvoke<string>('push', { path, setUpstream, force }, ''),

  // Resolve a conflicted file ("ours" | "theirs" | "mark").
  resolveConflict: (path: string, file: string, side: string) =>
    gitInvoke<null>('resolve_conflict', { path, file, side }, null),

  // Open the repo folder in an external app ("files" | "terminal" | "editor").
  openIn: (path: string, app: 'files' | 'terminal' | 'editor') =>
    gitInvoke<null>('open_in', { path, app }, null)
};
