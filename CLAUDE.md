# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`glimpse` is a **lightweight, git-native desktop Git client** — a slim, free GitKraken-style tool. It shows the multi-branch graph and diffs, and supports everyday write actions (stage, commit, branch, push/pull). It stays small and fast by shelling out to the user's real `git` instead of reimplementing it.

It is **not** an AI-agent-specific tool. The earlier "AI companion / Revert-AI / prompt-to-diff" framing is dropped. The differentiators are now **git-native behaviour**, a **small footprint**, and **first-class WSL support** on Windows.

> [!IMPORTANT]
> **`docs/ARCHITECTURE.md` is the source of truth** for product + technical decisions (scope, WSL handling, stack, distribution). Read it before making design choices. The application code (Tauri + Nuxt) is being scaffolded; the meta layer (lint, format, hooks, CI, release-please) is inherited from the `scaffold` template.

## Architecture (summary — see `docs/ARCHITECTURE.md`)

- **Platforms:** **Windows and Linux are both first-class** native builds (macOS later). CI compiles on an ubuntu + windows matrix.
- **Desktop shell:** Tauri (Rust). OS-native WebView (WebView2 on Windows, WebKitGTK on Linux) — no Chromium/Electron. Small disk + RAM footprint.
- **Frontend:** Nuxt 4 (Vue 3) SPA (`ssr: false`), Tailwind v4 + shadcn-vue, Pinia, `@nuxtjs/i18n` (de + en), `@nuxtjs/color-mode` (dark/light follows OS). App code lives in `app/` (Nuxt 4 srcDir).
- **Git engine:** shells out to the **system `git` binary**, native on every OS. `src-tauri/src/wsl.rs::resolve()` is native by default; on **Windows only** a `\\wsl$` repo path is routed through the distro's git via `wsl.exe -d <distro> -- git`. Credentials come from the user's own git setup; glimpse stores no secrets.
- **WSL (Windows-only twist):** auto-resolve per repo (Windows path → Windows git, `\\wsl$` path → WSL git). FS watcher is best-effort over `\\wsl$`, backed by manual + on-window-focus refresh. There is no WSL on Linux/macOS — git is simply native.
- **Diff:** `@git-diff-view/vue`, side-by-side (default) / unified toggle. **Graph:** SVG from structured `git log`.
- **v1 write actions:** stage/unstage (file-level), discard, commit, amend; branch create/switch/delete/rename + commit checkout; fetch/pull/push. _Out of scope v1:_ hunk/line staging, stash, merge/rebase, blame, submodules/worktrees/LFS.

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
| `pnpm check`      | Runs `lint` + `format` — the CI gate                       |
| `pnpm lint:fix`   | Auto-fix lint                                              |
| `pnpm format:fix` | Auto-fix format                                            |
| `pnpm check:fix`  | Auto-fix lint + format                                     |
| `pnpm taze`       | Interactive dependency upgrade check                       |
| `pnpm taze:w`     | Write upgrade results                                      |

App commands (once scaffolded): `pnpm dev` (Nuxt dev server, browser-testable), `pnpm tauri dev` (desktop dev shell), `pnpm tauri build` (packaged binary). Planned tests: Rust unit tests for the git/WSL backend layer. CI currently runs `pnpm lint` and `pnpm format`; it will gain `cargo fmt --check`, `cargo clippy`, and a Tauri build check.

## Meta-layer conventions

- **Node 24, pnpm 11.** Pinned via `.nvmrc`, `engines`, and `packageManager`. `.npmrc` enforces `minimumReleaseAge=4320` (3-day cooldown), `trustPolicy=no-downgrade`, isolated node-linker. Don't loosen these without reason.
- **oxc, not eslint/prettier.** Linting via `oxlint`, formatting via `oxfmt`. Configs live in `.oxlintrc.json` / `.oxfmtrc.json`. `oxlint` uses `unicorn` + `oxc` plugins; rules deliberately minimal.
- **Husky hooks** (`.husky/pre-commit`, `.husky/commit-msg`) run `lint-staged` and `commitlint`. `lint-staged.config.js` excludes `README.md` and `pnpm-lock.yaml`. `oxlint --fix --deny-warnings` then `oxfmt` on JS; `oxfmt` only on JSON/YAML/MD.
- **Conventional Commits enforced** via `@commitlint/config-conventional`. Don't `--no-verify` unless explicitly asked.
- **release-please** drives versioning. Files: `release-please-config.json` (`release-type: node`, `include-v-in-tag: true`), `.release-please-manifest.json`, `.github/workflows/release-please.yml`. The repo starts at `0.0.0`.
- **Workflows** use `actions/checkout@v6`, `actions/setup-node@v6`, `pnpm/action-setup@v6`, `github/codeql-action/{init,analyze}@v4`. Keep these pinned to major versions; Dependabot bumps them monthly.
- **CodeQL** scans `actions` + `javascript-typescript` with `security-extended,security-and-quality` queries, gated by path filters. When Rust lands, consider extending coverage.
- **Dependabot** groups all minor/patch updates per ecosystem into a single PR. Majors come as separate PRs.

## House style for READMEs and meta files

The `/write-readme` skill encodes the canonical structure. Key rules: hero block wrapped in `<div align="center">`, prescribed section emojis (✨ Features, 🚀 Setup, 🤝 Contributing, 🛣️ Versioning, 📄 License), license footer always reads `[MIT](LICENSE) © [Titus Kirch](https://github.com/TitusKirch/) / [IT-Dienstleistungen Titus Kirch](https://kirch.dev)`. Use GitHub callouts (`> [!TIP]`, `> [!IMPORTANT]`), never plain blockquotes.
