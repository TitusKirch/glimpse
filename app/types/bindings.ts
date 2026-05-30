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

export type RepoInfo = {
  toplevel: string;
  currentBranch: string;
  branches: Array<string>;
  remoteBranches: Array<string>;
  remotes: Array<string>;
  tags: Array<string>;
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
};
