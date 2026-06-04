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
- ⏳ #47 Faster session restore — instant tabs + lazy-load

## 0.6.0 — Staging, stash & history safety

- ⏳ #28 Stash improvements — preview, partial, include untracked
- ⏳ #29 Reflog view & "undo last action"
- ⏳ #30 Line-level staging and discard a hunk
- ⏳ #32 Cherry-pick / revert multiple or ranges (incl. merge revert)

## 0.7.0 — Compare & rebase

- ⏳ #25 Rebase the current branch onto another ref
- ⏳ #26 Interactive rebase
- ⏳ #27 Compare arbitrary refs

## 0.8.0 — Advanced / power-user

- ⏳ #34 Submodule support
- ⏳ #35 Git LFS support
- ⏳ #36 Worktree management
- ⏳ #37 Bisect
- ⏳ #38 Sparse-checkout

## Log

- Branch `feat/milestone-0-5-0` created from `dev`; progress file added.
- #45: WSL repos now watched via `PollWatcher` (native events don't cross the
  9P/SMB bridge); native repos keep the OS event backend. Debounce + poll
  interval overridable via env. Live `\\wsl$` burst test needs a Windows build
  (only buildable/observable there).
