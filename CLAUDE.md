# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`glimpse` is an **ultra-lightweight, passive Git diff & graph viewer** — a desktop companion for developers who drive AI coding agents (Claude CLI, Aider, Codex, custom scripts) from the terminal. It watches the repository and renders diffs and the branch graph in real time so the user can review what the agent changed, without keeping a heavy IDE open just as a viewer.

It is deliberately **read-only / review-focused**: no merge, rebase, or push dialogs. Speed and a tiny footprint are the point.

> [!NOTE]
> The repo currently ships only the meta layer (lint, format, hooks, CI, release-please) inherited from the `scaffold` template. The application code (Tauri + Nuxt) is being built out — see the intended architecture below and `TEMP_AI.md` for the original design brief.

## Intended architecture

- **Desktop shell:** Tauri (Rust). Uses the OS-native webview — no Chromium/Electron. Target: very small disk + RAM footprint.
- **Frontend:** Nuxt 3 (Vue 3, Tailwind CSS), SPA mode (`ssr: false`).
- **Diff engine:** `@git-diff-view/vue` for side-by-side / unified diffs with Web-Worker syntax highlighting.
- **Graph:** SVG rendered from structured `git log` data produced by the Rust backend.
- **Data flow:** Rust backend runs native Git queries + a filesystem watcher → emits Tauri IPC events → Nuxt frontend repaints. The FS watcher is what makes diffs auto-refresh the instant an agent saves a file.

Key features that differentiate it: live auto-refresh on FS events, a prominent "Revert AI" button (roll back all uncommitted changes from the current agent run), and a focus on review-only workflows.

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

Once the Tauri/Nuxt app lands, `pnpm tauri dev` (dev shell) and `pnpm tauri build` (packaged binary) will be the primary app commands. There is no test suite yet; CI currently runs `pnpm lint` and `pnpm format` on PR.

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
