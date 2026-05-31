// GENERATED from src-tauri/src/git.rs by `cargo test` (ts-rs).
// Do not edit — change the Rust structs and re-run.

export type Commit = {
  hash: string;
  subject: string;
  author: string;
  date: string;
  refs: Array<string>;
  parents: Array<string>;
  lane: number;
};

export type Branch = {
  name: string;
  /**
   * Commits ahead of / behind the configured upstream (0 if none).
   */
  ahead: number;
  behind: number;
};

export type StashEntry = {
  /**
   * Stash ref, e.g. `stash@{0}` — used for pop/apply/drop.
   */
  reference: string;
  message: string;
};

export type RepoInfo = {
  toplevel: string;
  currentBranch: string;
  branches: Array<Branch>;
  remoteBranches: Array<string>;
  remotes: Array<string>;
  tags: Array<string>;
  stashes: Array<StashEntry>;
  flavor: string;
  distro: string | null;
};

export type DiffData = {
  fileName: string;
  oldContent: string;
  newContent: string;
  hunks: Array<string>;
};

export type CommitFile = {
  path: string;
  /**
   * Single-letter change status: M, A, D, R, C.
   */
  status: string;
};

export type StatusEntry = {
  path: string;
  /**
   * Index (staged) status char, e.g. "M", "A", "D", "?".
   */
  x: string;
  /**
   * Worktree (unstaged) status char.
   */
  y: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  /**
   * Unmerged (merge-conflict) entry — shown in its own section.
   */
  conflicted: boolean;
};
