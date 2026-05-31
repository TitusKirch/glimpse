# glimpse — Architecture & Specification

> Source of truth for what glimpse is and how it's built. Captures the product and
> technical decisions taken before implementation. Supersedes the original brain-dump
> in `TEMP_AI.md`.

## 1. Vision

`glimpse` is a **lightweight, git-native desktop Git client** — think a slim, free
GitKraken-style tool. It shows the branch graph and diffs, and supports the everyday
write actions (stage, commit, branch, push/pull). It stays small and fast, leaning on
the user's real `git` rather than reimplementing it.

It is **not** an AI-agent-specific tool. The original "AI companion / Revert-AI" framing
is dropped: no AI-reset button, no prompt-to-diff mapping. The differentiators are now
**git-native behaviour**, a **small footprint**, and **first-class WSL support** on Windows.

## 2. Scope (v1)

### In scope

- **Viewing:** full multi-branch commit graph, diffs (side-by-side + unified), commit
  detail (changed files + diff of a selected commit), branch comparison (ahead/behind).
- **Write actions:**
  - _Local basics:_ stage/unstage **whole files**, discard changes, commit, `commit --amend`.
  - _Branching:_ create / switch / delete / rename branches, checkout a commit (detached HEAD).
  - _Remote sync:_ fetch, pull, push (incl. `--force-with-lease`).
- **Live refresh:** filesystem watcher auto-refreshes status/diff/graph, with manual +
  on-focus refresh as fallback.
- **Multi-repo:** several repositories open at once in **tabs**.
- **Platforms:** **Windows and Linux are both first-class** native builds (macOS later).
  git runs natively on every platform; WSL is the one Windows-only twist.
- **WSL (Windows only):** install on Windows, transparently use WSL `git`/`bash` for repos
  that live in the WSL filesystem. There is no WSL concept on Linux/macOS — git is native there.

### Explicitly out of scope for v1 (later)

- Hunk-/line-level staging (v1 is file-level only).
- Stash, cherry-pick, tags, merge, rebase, interactive history rewriting.
- File history / blame, commit search/filter.
- Submodules, multiple worktrees, Git LFS special handling. _(Detached HEAD is only
  displayed cleanly — it arises from commit checkout — but not otherwise "managed".)_
- macOS builds (Windows + Linux are both first-class; macOS comes later).
- Windows Authenticode code-signing (pipeline is prepared so it can be added later).
- An integrated terminal, a command palette, telemetry.

## 3. Tech stack

| Layer           | Choice                                                                     |
| :-------------- | :------------------------------------------------------------------------- |
| Desktop shell   | **Tauri** (Rust), OS-native WebView (WebView2 on Win / WebKitGTK on Linux) |
| Frontend        | **Nuxt 4** (Vue 3), SPA mode (`ssr: false`), app code in `app/`            |
| Styling / UI    | **Tailwind v4** + **shadcn-vue** (Reka UI based, copy-in components)       |
| State           | Pinia (per-repo store), Tauri events → store updates                       |
| Diff rendering  | `@git-diff-view/vue` (side-by-side / unified, Web-Worker highlighting)     |
| Graph rendering | SVG generated from structured `git log` data produced by the backend       |
| i18n            | `@nuxtjs/i18n` — German + English from day one                             |
| Git access      | **System `git` binary** (shell-out), Windows git or WSL git per repo       |
| FS watcher      | Rust `notify` crate, best-effort (incl. `\\wsl$` paths)                    |

## 4. Git engine — "git native"

glimpse never reimplements git: it **shells out to the real `git` binary** and parses
machine-readable output (`--porcelain`, `-z`, `--format=...`). Consequences:

- Behaviour, config, hooks, and credentials are exactly the user's own git.
- This is also what makes WSL support possible (run the distro's git unchanged).

### Resolution per repo

For each opened repository glimpse decides **which git** to use:

- **Windows path** (e.g. `C:\dev\repo`) → Windows `git`.
- **WSL path** (`\\wsl$\<distro>\...` or `\\wsl.localhost\<distro>\...`) → that distro's
  git, invoked as `wsl.exe -d <distro> -- git -C <linux-path> ...`.

Path translation between the Windows UNC form and the Linux path
(`/home/<user>/repo`) happens in a dedicated module — the most test-worthy code in the
backend (see §9).

### Credentials

glimpse relies entirely on the **system git credential setup** — credential helpers,
SSH agent, stored tokens. Windows git and each WSL distro use their own configuration.
glimpse stores **no** secrets and ships no credential UI in v1.

## 5. WSL integration

- **Detection:** on first run (and on demand) enumerate installed distros via
  `wsl.exe -l -v`; detect the Windows git via `where git` / PATH.
- **Repo opening:** native folder picker — it can already browse `\\wsl$` / `\\wsl.localhost`
  UNC paths, so no separate distro-browser flow is needed in v1.
- **Live refresh over WSL:** the Windows FS watcher receives events for native Windows
  paths reliably; over the `\\wsl$` 9P share it is **best-effort** and may miss events.
  This is accepted, mitigated by the **manual + on-focus** refresh fallback (a refresh
  fires whenever the glimpse window regains focus, which covers practically all missed
  events). A WSL-internal inotify helper is a possible later upgrade.

## 6. UI

### Layout — three-pane

```
┌────────┬──────────────┬───────────────┐
│SIDEBAR │ COMMIT GRAPH │  DIFF         │
│branches│ ● main       │  +++  ---     │
│remotes │ │╲           │  side-by-side │
│tags    │ ● ●          │  (default)    │
└────────┴──────────────┴───────────────┘
```

- **Sidebar:** branches, remotes, tags; repo switcher.
- **Center:** full multi-branch commit graph (SVG).
- **Right:** diff panel — **side-by-side by default**, unified toggle; syntax highlighting.
- **Repos:** opened in **tabs** across the top.
- **Commit box:** plain subject + body (no built-in Conventional-Commit helper in v1).
- **Theme:** dark + light, follows the OS, manually switchable.
- **Onboarding:** first-run **setup check** — detect Windows git + WSL distros/git and
  warn if something required is missing.

## 7. Data flow

```
[ editor / AI agent / CLI ] ── writes files ──▶ [ repo on disk (Windows or WSL fs) ]
                                                          │
                                                   FS event (best-effort)
                                                          ▼
[ Tauri backend (Rust) ] ── git CLI (Windows git or `wsl.exe … git`) ──▶ status/diff/log
        │                                                        + window-focus / manual refresh
   Tauri IPC events
        ▼
[ Nuxt 4 frontend ] ──▶ Pinia store ──▶ graph (SVG) + diff (@git-diff-view) repaint
```

## 8. Distribution & versioning

- **Installers:** NSIS `.exe` on Windows; AppImage + `.deb` on Linux. (macOS `.dmg` later.)
- **CI build matrix:** every PR compiles the app on **ubuntu-latest and windows-latest**
  (`cargo fmt --check`, `clippy -D warnings`, `tauri build --no-bundle`).
- **Auto-update:** Tauri updater against GitHub Releases. Requires a **Tauri updater
  signing key** (separate from Authenticode) — this key/secret is set up even though
  Windows Authenticode signing is deferred. App ships **unsigned** for now (SmartScreen
  warning accepted); the pipeline is structured so Authenticode can be slotted in later.
- **Versioning:** **release-please** is the single source of truth. Configured via
  `extra-files` so it bumps `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json` together in one release PR. Repo starts at `0.0.0`.

## 9. Quality

- **Tests (v1):** Rust unit tests for the risky backend logic — git output parsing,
  WSL path translation, distro/git detection. Frontend is untested in v1.
- **CI:** existing `oxlint` + `oxfmt` gates, **plus** `cargo fmt --check`,
  `cargo clippy` (deny warnings), and a `tauri build` compile on a **Linux + Windows**
  matrix. CodeQL to be extended to Rust later.
- **Telemetry:** none. Local logs only, for debugging.

## 10. Repository layout (target)

```
glimpse/
├─ src-tauri/            # Rust backend: git layer, WSL resolver, FS watcher, IPC
│  ├─ Cargo.toml
│  └─ tauri.conf.json
├─ app/ (Nuxt)           # Vue 3 + Tailwind + shadcn-vue, i18n, Pinia, diff/graph views
├─ docs/ARCHITECTURE.md  # this file
└─ (existing meta layer: oxc, husky, release-please, CI, …)
```

## 11. Open questions / later

- WSL-internal inotify helper for reliable live refresh (upgrade over best-effort).
- Hunk/line staging, stash, tags, merge, file history/blame, commit search.
- Native Linux & macOS builds; CodeQL for Rust; Authenticode signing.
- Optional Conventional-Commit helper in the commit box.
