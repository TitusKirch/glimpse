# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent instruction files

`CLAUDE.md` and `AGENTS.md` are kept **byte-identical**. `CLAUDE.md` is what Claude Code reads; `AGENTS.md` is what vendor-neutral agent tools read — Codex, OpenCode, Cursor, Copilot, and whatever follows them. Two real files, deliberately not a symlink: not every tool resolves one.

**After editing either file, copy it over the other — don't repeat the edit by hand:**

```bash
cp CLAUDE.md AGENTS.md   # or the reverse, whichever you just edited
```

Retyping a change is exactly how the two drift; one reflowed line or reworded clause is enough. `diff CLAUDE.md AGENTS.md` must print nothing. If it ever does, treat it as a defect and fix it by letting one file win wholesale — never by merging them.

## What this repo is

`glimpse` is a **lightweight, git-native desktop Git client** — a slim, free GitKraken-style tool. It shows the multi-branch graph and diffs, and supports everyday write actions (stage, commit, branch, push/pull). It stays small and fast by shelling out to the user's real `git` instead of reimplementing it.

It is **not** an AI-agent-specific tool. The earlier "AI companion / Revert-AI / prompt-to-diff" framing is dropped. The differentiators are now **git-native behaviour**, a **small footprint**, and **first-class WSL support** on Windows.

> [!IMPORTANT]
> **The `README.md` and the code are the source of truth.** (The earlier `docs/ARCHITECTURE.md` spec has been removed — it had diverged from the shipped app.) The application (Tauri + Nuxt) is substantially built; the meta layer (lint, format, hooks, CI, release-please) is inherited from the `scaffold` template.

## Architecture (summary)

- **Platforms:** **Windows and Linux are both first-class** native builds. macOS also compiles in CI but is **untested** (and unsigned). CI builds on an **ubuntu + windows + macos** matrix.
- **Desktop shell:** Tauri (Rust). OS-native WebView (WebView2 on Windows, WebKitGTK on Linux) — no Chromium/Electron. Small disk + RAM footprint.
- **Frontend:** Nuxt 4 (Vue 3) SPA (`ssr: false`), Tailwind v4 + shadcn-vue (Reka UI), Pinia (persisted to `localStorage`), `@nuxtjs/i18n` (**`en-GB` default, plus `de-DE`, `es-ES`, `fr-FR`**), `@nuxtjs/color-mode` (system preference, dark fallback). App code lives in `app/` (Nuxt 4 srcDir).
- **Backend (`src-tauri/src/`):** `lib.rs` registers the Tauri commands and the debounced FS watcher (`notify`); `git.rs` + `git/parse.rs` are the shell-out git engine (porcelain parsing); **`platform.rs::resolve()`** picks the git target per repo (this replaced the old `wsl.rs`).
- **Git engine:** shells out to the **system `git` binary**, native on every OS. `platform.rs::resolve()` is native by default; on **Windows only** a `\\wsl$` / `\\wsl.localhost` repo path is routed through the distro's git via `wsl.exe -d <distro> --cd <linux-path> --exec git`. Credentials come from the user's own git setup; glimpse stores no secrets.
- **WSL (Windows-only twist):** auto-resolve per repo (Windows path → Windows git, `\\wsl$` path → WSL git). FS watcher is best-effort over `\\wsl$`, backed by manual + on-window-focus refresh. There is no WSL on Linux/macOS — git is simply native.
- **Diff:** custom `CodeDiff.vue` + `app/utils/highlight.ts` (highlight.js) + `app/utils/wordDiff.ts` — side-by-side (default) / unified toggle, ignore-whitespace, blame, file history. _(Not `@git-diff-view/vue` — that was dropped.)_ **Graph:** SVG from structured `git log`.
- **Feature surface (built):** viewing (multi-branch graph, commit search, diffs, blame, file history); staging by **file or hunk**, discard, commit, amend, conflict resolution (ours/theirs); branches create/switch/rename/delete/merge + branch-from-commit + checkout commit; cherry-pick/revert/reset (soft/mixed/hard); tags create/delete/push; stash save/pop/apply/drop; remotes add/rename/remove; fetch/pull (incl. rebase)/push (set-upstream, `--force-with-lease`); command palette, keyboard shortcuts, multi-repo tabs, recent repos, "open in editor/terminal/file manager", built-in auto-update (Tauri updater).

## Dev & testing on WSL

This repo is often developed inside WSL2. Practical loop:

- **Frontend demo:** `pnpm dev` (Nuxt) runs in WSL; open `http://localhost:3000` from the Windows browser. Fastest UI iteration. Backend IPC is mocked when not running under Tauri.
- **Full Tauri shell in WSL:** needs `rustup` + `webkit2gtk-4.1` + build deps; produces a **Linux** build shown via WSLg. Not the Windows target.
- **WSL-git feature + Windows behaviour:** can only be exercised in a **Windows** build (that's where `wsl.exe` is invoked). Build/run on Windows for those.

## Commands

| Command           | What it does                                               |
| :---------------- | :--------------------------------------------------------- |
| `pnpm install`    | Install deps and wire husky hooks via the `prepare` script |
| `pnpm lint`       | `oxlint . --deny-warnings`                                 |
| `pnpm format`     | `oxfmt --check .` (note: `format` is the check, not fix)   |
| `pnpm cargofmt`   | `cargo fmt --check` for the Rust backend                   |
| `pnpm check`      | Runs `lint` + `format` + `cargofmt` — the CI gate          |
| `pnpm lint:fix`   | Auto-fix lint                                              |
| `pnpm format:fix` | Auto-fix format                                            |
| `pnpm check:fix`  | Auto-fix lint + format + Rust formatting                   |
| `pnpm test`       | Frontend unit tests (Vitest)                               |
| `pnpm taze`       | Interactive dependency upgrade check                       |
| `pnpm taze:w`     | Write upgrade results                                      |

App commands: `pnpm dev` (Nuxt dev server, browser-testable with mocked IPC), `pnpm tauri dev` (desktop dev shell), `pnpm tauri build` (packaged binary). Tests: Rust unit tests cover the risky backend (git output parsing, WSL path translation) plus a few Vitest component specs. CI already runs `oxlint` + `oxfmt`, and on the ubuntu/windows/macos matrix `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, and `pnpm tauri build`.

## Meta-layer conventions

- **Node 24, pnpm 11.** Pinned via `.nvmrc`, `engines`, and `packageManager`. `pnpm-workspace.yaml` enforces `minimumReleaseAge=4320` (3-day cooldown), isolated node-linker. Don't loosen these without reason.
- **oxc, not eslint/prettier.** Linting via `oxlint`, formatting via `oxfmt`. Configs live in `.oxlintrc.json` / `.oxfmtrc.json`. `oxlint` uses `unicorn` + `oxc` plugins; rules deliberately minimal.
- **Husky hooks** (`.husky/pre-commit`, `.husky/commit-msg`) run `lint-staged` and `commitlint`. `lint-staged.config.js`: `oxlint --fix --deny-warnings` then `oxfmt` on JS/TS; `oxfmt` on JSON/JSONC/YAML/TOML/MD (excluding `README.md` and `pnpm-lock.yaml`); `rustfmt --edition 2021` on `*.rs`.
- **Conventional Commits enforced** via `@commitlint/config-conventional`. Don't `--no-verify` unless explicitly asked.
- **release-please** drives versioning. Files: `release-please-config.json` (`release-type: node`, `include-v-in-tag: true`), `.release-please-manifest.json`, `.github/workflows/release-please.yml`. The repo starts at `0.0.0`.
- **Workflows** use `actions/checkout@v6`, `actions/setup-node@v6`, `pnpm/action-setup@v6`, `github/codeql-action/{init,analyze}@v4`. Keep these pinned to major versions; Dependabot bumps them monthly.
- **CodeQL** scans `actions` + `javascript-typescript` with `security-extended,security-and-quality` queries, gated by path filters. When Rust lands, consider extending coverage.
- **Dependabot** groups all minor/patch updates per ecosystem into a single PR. Majors come as separate PRs.

## House style for READMEs and meta files

The `/write-readme` skill encodes the canonical structure. Key rules: hero block wrapped in `<div align="center">`, prescribed section emojis (✨ Features, 🚀 Setup, 🤝 Contributing, 🛣️ Versioning, 📄 License), license footer always reads `[MIT](LICENSE) © [Titus Kirch](https://github.com/TitusKirch/) / [IT-Dienstleistungen Titus Kirch](https://kirch.dev)`. Use GitHub callouts (`> [!TIP]`, `> [!IMPORTANT]`), never plain blockquotes.
