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
  /**
   * GPG/SSH signature verification status from `%G?`: `G` good, `U` good but
   * of unknown validity, `B` bad, `X`/`Y`/`R` expired/revoked, `E` cannot
   * check, `N` unsigned (empty when git reports nothing).
   */
  signatureStatus: string;
  /**
   * Signer name (`%GS`) when the commit is signed, else empty.
   */
  signerName: string;
  /**
   * Signing key / fingerprint (`%GK`) when available, else empty.
   */
  signerKey: string;
};

export type Branch = {
  name: string;
  /**
   * Commits ahead of / behind the configured upstream (0 if none).
   */
  ahead: number;
  behind: number;
  /**
   * True when the branch has a live upstream (it exists on a remote). False
   * for a purely local branch — never pushed, or its remote ref is `gone`.
   */
  published: boolean;
};

export type ReflogEntry = {
  /**
   * Reflog selector, e.g. `HEAD@{0}`.
   */
  selector: string;
  /**
   * Abbreviated commit hash the entry points at.
   */
  hash: string;
  /**
   * Reflog subject, e.g. `reset: moving to HEAD~1`.
   */
  subject: string;
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
  /**
   * True when a rebase is paused (e.g. on a conflict) awaiting
   * continue / skip / abort.
   */
  rebaseInProgress: boolean;
  /**
   * True when a `git bisect` session is active.
   */
  bisectInProgress: boolean;
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

export type BlameLine = {
  line: number;
  /**
   * Abbreviated commit hash that last touched this line.
   */
  hash: string;
  author: string;
  date: string;
  content: string;
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
