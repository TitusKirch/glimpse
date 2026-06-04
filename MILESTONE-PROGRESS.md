# Milestone progress (autonomous run)

Branch chain: `feat/milestone-0-5-0` (from `dev`) → `feat/milestone-0-6-0` →
`feat/milestone-0-7-0` → `feat/milestone-0-8-0`. One Conventional Commit per
issue (`Closes #N`). Verified before each commit: `pnpm check`,
`cargo clippy -D warnings`, `cargo test`, `pnpm test` (+ `pnpm bindings` when
Rust structs change). Nothing pushed. This file is updated within each issue's
commit so progress survives context compaction.

Legend: ✅ done · 🅿️ parked (reason) · ⏳ planned

## 0.5.0 — Performance & startup UX

- ✅ #45 Faster, reliable filesystem watching (polling fallback for WSL)
- ✅ #47 Faster session restore — instant tabs + lazy-load

## 0.6.0 — Staging, stash & history safety

- ✅ #28 Stash improvements — preview, partial, include untracked
- ✅ #29 Reflog view & "undo last action"
- 🅿️ #30 Line-level staging and discard a hunk — _partial_: discard-hunk done;
  line-level staging parked (correct patch surgery to stage a subset of a hunk's
  lines + the line-selection UI is large/risky vs. the remaining budget). Issue
  left open (`Refs #30`, not closed).
- ✅ #32 Cherry-pick / revert multiple or ranges (incl. merge revert)

## 0.7.0 — Compare & rebase

- ✅ #25 Rebase the current branch onto another ref
- 🅿️ #26 Interactive rebase — parked. Largest feature in the set: needs
  non-interactive `rebase -i` driving (GIT_SEQUENCE_EDITOR injecting a generated
  todo + GIT_EDITOR feeding per-commit messages for reword/squash/fixup, all
  cross-platform incl. the WSL `wsl.exe` path), a plan-builder UI
  (drag-reorder + per-row action + message editors), and continue/abort across
  the plan. Too large to complete and verify cleanly within this run's budget
  without risking a broken flagship feature. Left open (not closed).
- ✅ #27 Compare arbitrary refs

## 0.8.0 — Advanced / power-user

- ⏳ #34 Submodule support
- ⏳ #35 Git LFS support
- ⏳ #36 Worktree management
- ✅ #37 Bisect
- ⏳ #38 Sparse-checkout

## Log

- Branch `feat/milestone-0-8-0` based on 0-7-0.
- #37: `bisect_start` / `bisect_mark` (good/bad/skip) / `bisect_reset`;
  `RepoInfo.bisectInProgress` (`git bisect log` probe) drives a banner in the
  changes panel; a start dialog picks bad/good refs; command-palette entry
  "Start bisect…". Git's step output (next commit / first-bad result) is toasted.
- #27: `compare_files` / `compare_file_diff` between two refs; new Compare dialog
  (two ref pickers + swap) reusing the file tree and diff viewer; command-palette
  entry "Compare refs…".
- Branch `feat/milestone-0-7-0` based on 0-6-0.
- #25: `rebase` onto a ref + continue/skip/abort; `RepoInfo.rebaseInProgress`
  (REBASE_HEAD probe) drives a banner in the changes panel; entry points in the
  branch context menu and command palette (new `rebase` branch page). Conflicts
  reuse the existing conflict UI; each step reloads even on conflict.
- #30 (partial): `discard_hunk` reverse-applies a hunk to the working tree; the
  diff viewer's unstaged hunks gain a "✕ discard" control (confirmed). Line-level
  staging parked — see above.
- #29: new `reflog` backend + Reflog dialog (reset/checkout to any entry);
  "Undo last action" (command palette) resets hard to `HEAD@{1}` with a confirm.
  Recovers reset/rebase/merge/commit; recovering a _deleted branch_ is out of
  scope (HEAD reflog doesn't capture it) — the reflog view still exposes the
  dangling commit to checkout/branch from.
- #32: cherry-pick/revert take commit arrays; graph Ctrl/Shift-click builds a
  multi-selection for bulk cherry-pick/revert; reverting a merge prompts for the
  mainline parent (`-m`). Mid-op conflicts fall to the existing conflict UI.
- Branch `feat/milestone-0-6-0` based on 0-5-0.
- #28: stash preview reuses the commit-detail view (click a stash → files +
  per-file diff via stash-specific backend, since a stash is a merge commit);
  new Stash dialog stashes everything or selected paths, with untracked files
  selectable (auto `-u`).
- Branch `feat/milestone-0-5-0` created from `dev`; progress file added.
- #45: WSL repos now watched via `PollWatcher` (native events don't cross the
  9P/SMB bridge); native repos keep the OS event backend. Debounce + poll
  interval overridable via env. Live `\\wsl$` burst test needs a Windows build
  (only buildable/observable there).
- #47: `restoreSession` now builds lightweight placeholder tabs instantly and
  loads only the active repo; others lazy-load on first activation (per-tab
  `loaded` flag, cached). Validation deferred to activation. Logic verified via
  gates; the instant-tabs UX is best confirmed in a running desktop build (the
  restore path is native-only, skipped in the browser demo).
