<div align="center">

# 👀 glimpse

**A passive, ultra-light Git diff & graph viewer for developers who pair with terminal AI agents**

</div>

---

Keep an eye on what your AI agent is doing — without leaving a heavyweight IDE open just to read diffs.

`glimpse` is a tiny desktop companion that watches your repository and shows you the diff and branch graph in real time. When Claude CLI, Aider, Codex, or your own scripts touch files in the terminal, the view updates instantly. No merge dialogs, no rebase wizards — read-only review at native speed.

## ✨ Features

- **🔄 Live auto-refresh** — a native filesystem watcher in the Rust backend repaints the diff the moment a file changes. No manual refresh, no focus switching.
- **↩️ Revert AI** — one prominent button rolls back all uncommitted changes from the current agent run when the AI gets it wrong.
- **🌳 Branch graph** — the commit graph rendered straight from `git log`, so you can follow what the agent committed at a glance.
- **🪶 Featherweight** — built on [Tauri](https://tauri.app/), it uses the OS-native webview instead of bundling Chromium. Tiny footprint, minimal RAM — a fraction of running VS Code as a viewer.
- **🎯 Review-only focus** — side-by-side and unified diffs with syntax highlighting, and nothing else competing for attention.

## 🚀 Setup

> [!IMPORTANT]
> glimpse is in early development. Until a packaged release lands, run it from source.

Prerequisites: Node **24+**, **pnpm 11**, the **Rust toolchain**, and the [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your platform.

```bash
git clone https://github.com/TitusKirch/glimpse.git
cd glimpse
pnpm install
pnpm tauri dev
```

## 🧱 Tech stack

| Layer        | Choice                                                         |
| :----------- | :------------------------------------------------------------ |
| Desktop      | [Tauri](https://tauri.app/) (Rust) — native webview, no Electron bloat |
| Frontend     | [Nuxt 3](https://nuxt.com/) (Vue 3, Tailwind CSS) in SPA mode (`ssr: false`) |
| Diff engine  | `@git-diff-view/vue` — side-by-side / unified diffs with Web-Worker highlighting |
| Graph        | SVG rendered from the Rust backend's structured `git log` data |
| Git & FS     | Native Git queries and a filesystem watcher in the Tauri backend |

## 🤝 Contributing

PRs welcome. Conventional Commits required (enforced via commitlint). Husky runs the project's linters/formatters on `git commit`.

> [!TIP]
> Run `pnpm check:fix` before pushing — CI will catch what husky missed.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## 🛣️ Versioning

[Semantic Versioning](https://semver.org/) via [release-please](https://github.com/googleapis/release-please) — see [CHANGELOG.md](CHANGELOG.md).

## 📄 License

[MIT](LICENSE) © [Titus Kirch](https://github.com/TitusKirch/) / [IT-Dienstleistungen Titus Kirch](https://kirch.dev)
