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

export type Worktree = {
  path: string;
  /**
   * Short branch name, or empty when detached/bare.
   */
  branch: string;
  /**
   * Abbreviated HEAD hash (empty for a bare worktree).
   */
  head: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
};

export type Submodule = {
  path: string;
  /**
   * Abbreviated checked-out commit.
   */
  sha: string;
  /**
   * `git submodule status` prefix: " " in sync, "+" needs update,
   * "-" uninitialised, "U" merge conflicts.
   */
  state: string;
};

export type SparseStatus = {
  /**
   * Whether sparse-checkout is active for this worktree.
   */
  enabled: boolean;
  /**
   * The included path patterns (cone-mode directories), empty when disabled.
   */
  patterns: Array<string>;
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
  /**
   * The file is tracked by Git LFS: the hunks show the small text *pointer*
   * (version / oid / size), not the real binary. The viewer frames it as an
   * LFS object instead of rendering it as source, and `old_content` /
   * `new_content` are left empty so the smudged binary is never shipped.
   */
  isLfs: boolean;
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
  /**
   * Path is managed by Git LFS (its `filter` attribute is `lfs`) — surfaced
   * as a badge so a pointer change isn't mistaken for a tiny text edit.
   */
  isLfs: boolean;
};

export type RebaseStep = {
  action: string;
  hash: string;
  message: string | null;
};

export type ImageDiff = {
  mime: string;
  /**
   * The committed (HEAD) image; null when the file is newly added.
   */
  old: string | null;
  /**
   * The working-tree image; null when the file was deleted.
   */
  new: string | null;
};

export type Contributor = { name: string; email: string; commits: number };

export type ActivityPoint = { date: string; count: number };

export type FileChurn = { path: string; changes: number };

export type RepoStats = {
  totalCommits: number;
  /**
   * Authors by commit count, descending.
   */
  contributors: Array<Contributor>;
  /**
   * Commits per day, ascending by date.
   */
  activity: Array<ActivityPoint>;
  /**
   * Most-changed files, descending (top 20).
   */
  churn: Array<FileChurn>;
};

export type SshKey = {
  /**
   * Absolute path to the private key (the `.pub` path with the extension
   * dropped), in the form the repo's git environment expects (a Linux path
   * for a WSL repo, a host path otherwise).
   */
  path: string;
  /**
   * The public key line (`<type> <base64> [comment]`).
   */
  publicKey: string;
};

export type SshStatus = {
  /**
   * The configured `credential.helper`, or empty when none is set.
   */
  helper: string;
  /**
   * Public SSH keys found under `~/.ssh` (path + contents).
   */
  publicKeys: Array<SshKey>;
};
