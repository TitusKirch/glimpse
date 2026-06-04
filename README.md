<div align="center">

<img src="assets/logo_256x256.png" alt="glimpse" width="128" height="128" />

# glimpse

**A lightweight, git-native desktop Git client — the full branch graph, diffs, and everyday git, with first-class WSL support**

[![Release](https://img.shields.io/github/v/release/TitusKirch/glimpse?style=flat-square&label=release&color=10b981)](https://github.com/TitusKirch/glimpse/releases/latest)
[![Beta](https://img.shields.io/github/v/tag/TitusKirch/glimpse?sort=semver&filter=*-beta*&style=flat-square&label=beta&color=f59e0b)](https://github.com/TitusKirch/glimpse/releases)
[![Tests](https://img.shields.io/github/actions/workflow/status/TitusKirch/glimpse/ci.yml?branch=main&style=flat-square&label=tests)](https://github.com/TitusKirch/glimpse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/TitusKirch/glimpse?style=flat-square&color=10b981)](LICENSE)

![glimpse — the multi-branch graph and diffs](.github/assets/preview.png)

</div>

---

```bash
# glimpse drives your real git, per repo — automatically:
git -C C:\dev\repo log --graph                               # a Windows-path repo → Windows git
wsl.exe -d Ubuntu --cd /home/you/repo --exec git log --graph # a \\wsl$ repo → that distro's git
```

That's it. A slim, fast desktop client that shells out to your own `git` — no reimplemented engine, no Chromium, and on Windows it transparently uses WSL git for repos that live in the WSL filesystem.

## ✨ Features

- **🪶 Featherweight** — built on [Tauri](https://tauri.app/), it uses the OS-native WebView (WebView2 / WebKitGTK) instead of bundling Chromium. Small disk and RAM footprint.
- **🧬 Git-native** — never reimplements git; it shells out to your real `git` binary and parses its porcelain output. Your config, hooks, and credentials apply unchanged, glimpse stores no secrets, and Git LFS-tracked files are detected and surfaced.
- **🪟 First-class WSL (Windows)** — a `\\wsl$` repository is driven through that distro's git automatically, while Windows-path repos use Windows git. No setup, no per-repo switch.
- **📂 Get a repo** — open a local folder, **clone** a remote, or **init** a brand-new repository.
- **🌳 Graph & history** — the full multi-branch commit graph, searchable history, per-commit detail (changed files + diff), and GPG/SSH signature verification status.
- **🔍 Rich diffs** — side-by-side, unified, or whole-file, with syntax highlighting, word-level diff, ignore-whitespace, blame, and file history.
- **✏️ Stage & commit** — stage/unstage by file, **hunk, or line**, discard, commit, amend, and resolve merge conflicts (use ours/theirs).
- **🌿 Branches, tags & stashes** — create/switch/rename/delete branches, merge, cherry-pick, revert, reset (soft/mixed/hard), tags, and stash save/pop/apply/drop.
- **🛠️ Advanced git** — rebase (interactive or onto a ref), guided bisect, compare any two refs, reflog recovery with one-click undo, plus worktrees, submodules, and sparse-checkout.
- **🔄 Live refresh** — a debounced filesystem watcher repaints status, diff, and graph as files change, with manual and on-window-focus refresh as fallback.
- **⌨️ Fast workflow** — command palette, keyboard shortcuts, drag-reorderable multi-repo tabs, a resizable sidebar, recent repos, and "open in editor / terminal / file manager".
- **🌓 Themed & localized** — dark/light follows the OS (manually switchable), with a localized UI.

<details>
<summary>Full feature list</summary>

- **Repositories** — open a local folder, clone a remote, or initialise a new repository.
- **Viewing** — multi-branch commit graph, commit search, side-by-side / unified / whole-file diffs with syntax highlighting and word-level diff, ignore-whitespace, blame, file history, list/tree file view, compare any two refs, GPG/SSH signature verification status, Git LFS-tracked files flagged.
- **Staging & commits** — stage / unstage by file, hunk, or line, discard by file or hunk, discard all, commit, `commit --amend`, conflict resolution (use ours/theirs, mark resolved).
- **Branches & tags** — create / switch / rename / delete branches, branch from a commit, publish (set upstream), merge in either direction, create / delete / push tags, checkout a commit (detached HEAD).
- **History rewriting** — cherry-pick / revert (one or many commits, incl. merge reverts), reset (soft / mixed / hard), rebase onto another ref or interactively (reword / squash / fixup / drop / reorder), guided bisect, reflog recovery view with undo-last-action.
- **Stash** — save (selected paths, optionally including untracked), pop, apply, drop, preview contents.
- **Worktrees, submodules & sparse-checkout** — list / add / remove / open linked worktrees, list / update / sync submodules, enable / disable and edit sparse-checkout paths.
- **Remotes & sync** — add / rename / remove remotes, fetch, pull (incl. rebase, with per-pull strategy), push (set-upstream, `--force-with-lease`), push tags.
- **App** — command palette, keyboard shortcuts, drag-reorderable multi-repo tabs, resizable sidebar, recent repositories, open in editor / terminal / file manager, built-in auto-update.

</details>

## 📦 Stack

[Tauri](https://tauri.app/) (Rust) shell + [Nuxt 4](https://nuxt.com/) (Vue 3) SPA, [Tailwind v4](https://tailwindcss.com/) + [shadcn-vue](https://www.shadcn-vue.com/), with git accessed by shelling out to the system binary.

<details>
<summary>Full stack</summary>

| Layer           | Choice                                                                       |
| :-------------- | :--------------------------------------------------------------------------- |
| Desktop shell   | [Tauri](https://tauri.app/) (Rust) — OS-native WebView, no Electron/Chromium |
| Frontend        | [Nuxt 4](https://nuxt.com/) (Vue 3), SPA mode (`ssr: false`), code in `app/` |
| Styling / UI    | [Tailwind v4](https://tailwindcss.com/) + [shadcn-vue](https://www.shadcn-vue.com/) (Reka UI) |
| State           | [Pinia](https://pinia.vuejs.org/) — per-repo store, persisted to `localStorage` |
| Diff rendering  | Custom side-by-side / unified / whole-file view; [highlight.js](https://highlightjs.org/) syntax highlighting + word-level diff |
| Graph rendering | SVG generated from structured `git log` data                                 |
| i18n            | [`@nuxtjs/i18n`](https://i18n.nuxtjs.org/) — localized UI                     |
| Git access      | System `git` binary (shell-out); Windows git or WSL git resolved per repo     |
| FS watcher      | Rust [`notify`](https://docs.rs/notify) (debounced), best-effort (incl. `\\wsl$`) |
| Updates         | [Tauri updater](https://v2.tauri.app/plugin/updater/) against GitHub Releases  |

</details>

## 🚀 Setup

Download a build from the [latest release](https://github.com/TitusKirch/glimpse/releases) and install it for your OS; it self-updates from there via the built-in Tauri updater.

- **Windows** — download `glimpse_<version>_x64-setup.exe` and run it. It's unsigned for now, so SmartScreen may warn: choose **More info → Run anyway**.
- **Linux (Ubuntu/Debian)** — download `glimpse_<version>_amd64.deb` and install it (an `.AppImage` and an `.rpm` are also provided):
  ```bash
  sudo apt install ./glimpse_*_amd64.deb
  ```
- **macOS (Apple Silicon)** — the build produces an unsigned `.app` bundle (no `.dmg` installer); extract it from the release assets and move **glimpse** to Applications.

> [!WARNING]
> **The macOS build is untested and unsigned.** It compiles in CI alongside Windows and Linux, but those two are the actively tested targets. Gatekeeper blocks it on first launch — right-click the app and choose **Open**. Use at your own risk.

### Manual setup (from source)

Prerequisites: Node **24+**, **pnpm 11**, the **Rust toolchain**, and the [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your platform.

```bash
git clone https://github.com/TitusKirch/glimpse.git
cd glimpse
pnpm install
pnpm tauri dev    # desktop dev shell
```

> [!TIP]
> For fast UI iteration you can run `pnpm dev` (the Nuxt dev server) and open `http://localhost:3000` in a browser — backend IPC is mocked when not running under Tauri.

## 🧬 Git-native & WSL

glimpse never reimplements git: it shells out to your real `git` and parses machine-readable output, so behaviour, config, hooks, and **credentials** are exactly your own. It stores no secrets and ships no credential UI.

On Windows it picks the right git **per repository**:

- a **Windows path** (e.g. `C:\dev\repo`) → Windows `git`;
- a **WSL path** (`\\wsl$\<distro>\…` / `\\wsl.localhost\<distro>\…`) → that distro's git, via `wsl.exe -d <distro> --cd <linux-path> --exec git …`.

On Linux and macOS git is simply native — there is no WSL concept. Live refresh over the `\\wsl$` 9P share is best-effort; the manual + on-focus refresh covers the rest.

## 🧪 Development

`pnpm tauri dev` for the desktop shell, `pnpm dev` for fast browser iteration, `pnpm check` for the CI gate. Rust unit tests cover the risky backend logic — git output parsing and WSL path translation — and CI builds across a Linux + Windows + macOS matrix (`cargo fmt --check`, `clippy -D warnings`, `cargo test`, `tauri build`).

<details>
<summary>All commands</summary>

| Command            | What it does                                  |
| :----------------- | :-------------------------------------------- |
| `pnpm dev`         | Nuxt dev server (browser-testable, mocked IPC) |
| `pnpm tauri dev`   | Desktop dev shell                             |
| `pnpm tauri build` | Packaged binary                               |
| `pnpm test`        | Frontend unit tests (Vitest)                  |
| `pnpm lint`        | `oxlint . --deny-warnings`                    |
| `pnpm format`      | `oxfmt --check .`                             |
| `pnpm cargofmt`    | `cargo fmt --check` for the Rust backend      |
| `pnpm cargo:update`   | Refresh Rust deps within semver            |
| `pnpm cargo:outdated` | Show major Rust-dep upgrades (needs `cargo-edit`) |
| `pnpm cargo:upgrade`  | Apply major Rust-dep upgrades (needs `cargo-edit`) |
| `pnpm check`       | `lint` + `format` + `cargofmt` — the CI gate  |
| `pnpm check:fix`   | Auto-fix lint, format, and Rust formatting    |

</details>

## 🎨 Assets & branding

> [!NOTE]
> The logo and app icons are **placeholder artwork, currently AI-generated** with [icongeneratorai.com](https://icongeneratorai.com/) — not final, temporary stand-ins to be replaced at some point, with no fixed timeline.

- **Source logo:** `assets/logo.png` (643×643). The platform icon set in `src-tauri/icons/` is regenerated from it via `pnpm tauri icon assets/logo.png`.
- **Display variants:** `assets/logo_256x256.png` (README hero) and `public/logo.png` + `public/logo_128x128.png` (served in-app — sidebar header, About screen).

**Brand colours** — the logo is a deep indigo→violet gradient (hue ≈ 289°) with a white mark, read straight from the artwork:

| Role              | Hex       | OKLCH                     |
| :---------------- | :-------- | :------------------------ |
| Gradient (dark)   | `#120A40` | `oklch(0.203 0.096 280)`  |
| Gradient (base)   | `#202050` | `oklch(0.274 0.086 279)`  |
| Gradient (violet) | `#403090` | `oklch(0.388 0.151 285)`  |
| Mark              | `#FFFFFF` | `oklch(1 0 0)`            |

## 🤝 Contributing

PRs welcome. Conventional Commits required (enforced via commitlint). Husky runs the project's linters/formatters on `git commit`.

> [!TIP]
> Run `pnpm check:fix` before pushing — CI will catch what husky missed.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## 🛣️ Versioning

[Semantic Versioning](https://semver.org/) via [release-please](https://github.com/googleapis/release-please) — see [CHANGELOG.md](CHANGELOG.md).

## 📄 License

[MIT](LICENSE) © [Titus Kirch](https://github.com/TitusKirch/) / [IT-Dienstleistungen Titus Kirch](https://kirch.dev)
