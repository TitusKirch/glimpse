# Working on glimpse

`glimpse` is a **lightweight, git-native desktop Git client** (graph, diffs, everyday writes) that shells out to the user's real `git`. Its differentiators are git-native behaviour, a small footprint and first-class WSL support. It is **not** an AI-agent tool; that framing is dropped.

> [!IMPORTANT]
> **`README.md` and the code are the source of truth** for features and the CLI surface. `docs/ARCHITECTURE.md` was removed because it had diverged.

## Architecture

- **Platforms:** Windows and Linux are first-class. macOS compiles in CI (ubuntu + windows + macos matrix) but is untested and unsigned.
- **Shell:** Tauri with the OS WebView (WebView2 / WebKitGTK), no Electron.
- **Frontend (`app/`, Nuxt 4 srcDir):** SPA (`ssr: false`), Tailwind v4 + shadcn-vue (Reka UI), Pinia persisted to `localStorage`, `@nuxtjs/i18n` (`en-GB` default, `de-DE`, `es-ES`, `fr-FR`), `@nuxtjs/color-mode`. Diff is the custom `CodeDiff.vue` + `app/utils/highlight.ts` + `app/utils/wordDiff.ts` (not `@git-diff-view/vue`); the graph is SVG from structured `git log`.
- **Backend (cargo workspace in `src-tauri/`):**
  - `crates/glimpse-core`: the engine. `git.rs` + `git/parse.rs` shell out and parse porcelain, `platform.rs::resolve()` picks the git target per repo, `changelist.rs` holds the changelist model.
  - `crates/glimpse-cli`: a library the GUI calls via `try_run_cli()` and the `glimpse-cli` console binary.
  - `src-tauri/src/lib.rs` (package `glimpse`): Tauri commands and the debounced `notify` watcher.
- **`glimpse-core` must not depend on Tauri**, so the CLI runs without a desktop. A crate unit test reads its manifest; CI runs `cargo tree --package glimpse-core` for the transitive claim. Anything needing an `AppHandle`, a window or IPC goes in the GUI package.
- **Git:** always the system `git`, native by default. Credentials come from the user's git setup; glimpse stores no secrets. On **Windows only**, a `\\wsl$` / `\\wsl.localhost` path runs `wsl.exe -d <distro> --cd <linux-path> --exec git`. The FS watcher is best-effort over `\\wsl$`, backed by manual and on-focus refresh.

## WSL launcher (`scripts/glimpse-wsl.sh`)

Inside a distro the installed `glimpse` is this script, so it decides what reaches the CLI. `tests/wsl_shim.rs` runs it under `sh` against argv-recording stubs.

- It tells a path from a subcommand exactly as `claims` does. Its `GLIMPSE_SUBCOMMANDS` is pinned against `SUBCOMMANDS` + `ALIASES` **in both directions**: adding a subcommand in Rust does not touch the script, and a word the launcher routes but the binary doesn't claim would shadow a directory of that name.
- **Native route** first: `$GLIMPSE_CLI`, `/usr/local/lib/glimpse/glimpse-cli`, then `glimpse-cli`/`glimpse` on PATH. Skip any candidate that resolves to the launcher itself, because the Linux package uses the same name and taking it re-execs forever. The native route hands argv over untouched.
- **Otherwise forward to `glimpse.exe`**, preferring the console binary beside it. Translate **only** `-C`, and inject `-C $PWD` when none is given. Every other path is repo-root-relative on both sides and passes through untouched. Respect `VALUE_OPTIONS` (pinned both ways): in `-m "-C"`, the `-C` is message text.
- The WSL gate guards the Windows routes only and reads `$WSL_DISTRO_NAME` before `/proc/version`. `-h`/`--help` belong to the launcher; bare `help` routes.
- **Before forwarding (Windows only)**, `pe_handler_registered` checks for a `WSLInterop` handler in `binfmt_misc`. `systemd-binfmt` can flush it after `/init` registers it, so without the check the user sees a bare `Exec format error`. When `binfmt_misc` is unmounted or unreadable, stay silent and try the `exec` anyway. The native route never checks.

## Packaging the CLI

- **Sidecar:** `bundle.externalBin` lives in `src-tauri/tauri.sidecar.conf.json`, **never** in `tauri.conf.json`: `tauri-build` resolves it on every compile, and a clean `cargo clippy`/`cargo test` would fail. It is merged with `--config` wherever the file is staged first: `pnpm tauri:build`, `ci.yml`'s tauri matrix and perf-baseline (via `jq`), and the release `tauri-action`. `scripts/build-cli-sidecar.test.ts` enforces both halves: no `externalBin` in the checked-in config, and the fragment on every bundle-producing invocation. `--no-bundle` is exempt, but `ci.yml`'s matrix opts in anyway, because that is the repo's only Windows evidence for the sidecar name.
- **`scripts/build-cli-sidecar.ts`** takes the host triple from `rustc -vV` (never `process.platform`) and stages `binaries/glimpse-cli-<triple>` (`.exe` after the triple). `--target` cross-builds, `--host` is a test seam, and `--print-plan` makes it testable without a toolchain. The binary ends up beside `glimpse.exe` on Windows and on PATH as `glimpse-cli` from the Linux packages.
- **WSL payload:** `scripts/build-wsl-payload.ts` builds a **static** `x86_64-unknown-linux-musl` binary, since glibc builds fail on older distros. `src-tauri/tauri.wsl-payload.conf.json` is a superset of the sidecar fragment, so the Windows leg passes one `--config`. It ships as the `glimpse-cli-linux-x86_64` resource. `_tauri-build.yml`'s `wsl-payload` job builds it on Linux and hands it to the Windows leg.
- **Install into distros:** `install_wsl_shims` calls `install_wsl_cli_into` next to `install_wsl_shim_into`. It writes `/usr/local/lib/glimpse/glimpse-cli`, which a unit test pins as `find_native`'s first path. Write a `.new` sibling and `mv` it into place, because overwriting a running ELF gives ETXTBSY. Before the move, check the byte count and run `--version`; on failure `rm -f` the sibling. Everything is best-effort: a missing payload, an unreadable `uname -m`, ARM64 or a refused write leaves that distro forwarding.
- **`wsl-smoke.yml`** installs a real distro on `windows-latest` and runs the one `#[ignore]`d test, which installs via `install_wsl_shims` and drives `glimpse status` through the launcher. No `glimpse.exe` exists there, so only the native route can answer. It triggers on `push`, because work lands on `dev` directly. A vitest guard pins its test filter to the test name on a word boundary, since a filter matching nothing exits 0.
- Still open: other architectures than x86-64, a distro-native package, and the installer (rather than CI) performing the install.

## CLI contracts

- **Shipped means listed:** a subcommand counts only once it is in `SUBCOMMANDS`, `glimpse --help` **and** the README; the guards read `GROUPED` too, so each _action_ is covered. Four cargo tests enforce this, and the README guard matches on a word boundary.
- **Keep the claim narrow.** The CLI works at file granularity. Don't write "every write action"; the README names what stays GUI-only.
- **Globals** `--json` and `-C` work before or after the subcommand: `globals_after_the_subcommand` rewrites argv, and `claims` looks past them, or the binary would read `-C` as a path and open a window.
- **Grouped commands** are a group word plus a verb (`branch create`, `stash drop`). The bare word lists, and `listing_instead` in `write.rs` routes it to `read.rs`, so each subject has one renderer.
- **Paths are repo-root-relative** on every command. `open_repo` in `crates/glimpse-cli/src/lib.rs` re-anchors at `rev-parse --show-toplevel`. Exceptions: `-C <dir>`, and the absolute paths `worktree add|remove` report. Any new exception has to be stated with the rule.
- **Destructive actions:** naming the subject is the confirmation (`discard <file>`, `branch delete <name>`, `stash drop <stash>`; `stash drop` never assumes `stash@{0}`). Without a subject, require `--force`: `discard --all --force`, and `reset --hard` only when something is at risk.
  - "At risk" is judged against the **target tree** (`Repo::paths_in_tree`), not `status`. Tracked and staged changes always count. An untracked path counts only when the target holds a file at that path, at an ancestor of it, or below it. Don't warn about untracked work the reset won't touch.
  - `branch delete --force` maps to `-D`; the plain form is `-d`.
- **Open operations:** a verb that _begins_ an operation (`branch merge`, `cherry-pick`, `revert`, `discard --all --force`) refuses while `refs::in_progress` sees `MERGE_HEAD` / `CHERRY_PICK_HEAD` / `REVERT_HEAD` or a paused rebase, and names the disputed paths. Detect rebases from the sequencer's state directory via git, never `Path::exists` and never `REBASE_HEAD`, which a `break` or failed `exec` doesn't set. `reset --hard` is not refused: it clears those refs and is currently the only way out.
- **Read outcomes back** from git rather than assuming them. Refs commands use the cheap `Repo` probes (`current_branch`, `branch_names`, `tag_names`, `remote_names`, `commits_since`, `remote_url`), not `info()`. Cherry-pick and revert report the hashes git wrote. `push_tags` uses `--porcelain` (the human output goes to stderr) and returns a `TagPush`, not a `Result`, because one rejected tag must not discard the record of the pushed ones (`Repo::run_capturing`).
- **`discard`** goes to HEAD, index included (`Repo::discard_to_head`). The GUI's per-file button keeps index-sourced semantics (`Repo::discard`); keep the two separate.
  - Plan against `status` first and refuse what git can't discard per path: unresolved conflicts and staged renames.
  - Run one `git restore` plus one `git clean` per batch, then read the result back from `status`.
  - `--all --force` snapshots the tree before destroying anything, and refuses during a merge, cherry-pick or revert.
- **Write receipt:** after a successful write the CLI drops `<git-dir>/glimpse/last-write.json` (`Repo::write_receipt`), sent from the single dispatcher in `write.rs`. The GUI watches it with a 50ms debounce. A failed notification must never fail the write.

## Dev & testing on WSL

- `pnpm dev` runs in WSL; open `http://localhost:3210` from Windows. IPC is mocked outside Tauri.
- `pnpm tauri dev` in WSL needs `rustup`, `webkit2gtk-4.1` and build deps, and produces a **Linux** build shown via WSLg.
- WSL-git routing and other Windows behaviour can only be exercised in a **Windows** build.
- WSL payload smoke test on Windows: `cargo test --manifest-path src-tauri/Cargo.toml -p glimpse --lib -- --ignored`, with `GLIMPSE_WSL_SMOKE_PAYLOAD_DIR` pointing at a staged `glimpse-cli-linux-x86_64`. `pnpm cli:wsl-payload` stages one in `src-tauri/binaries`.

## Commands

| Command                      | What it does                                                                                  |
| :--------------------------- | :-------------------------------------------------------------------------------------------- |
| `pnpm install`               | Install deps, wire husky hooks                                                                |
| `pnpm lint` / `lint:fix`     | `oxlint . --deny-warnings`                                                                    |
| `pnpm format` / `format:fix` | `oxfmt --check .` (`format` is the check, not the fix)                                        |
| `pnpm typecheck`             | `vue-tsc` over three configs: app, e2e suite, Node tooling                                    |
| `pnpm cargofmt`              | `cargo fmt --check` for the Rust workspace                                                    |
| `pnpm test`                  | Vitest                                                                                        |
| `pnpm check` / `check:fix`   | `lint` + `format` + `typecheck` + `cargofmt` + `test` / auto-fix lint, format and Rust format |
| `pnpm taze` / `taze:w`       | Check / write npm upgrades                                                                    |
| `pnpm tauri dev`             | Desktop dev shell                                                                             |
| `pnpm tauri build`           | Compile the app (no sidecar)                                                                  |
| `pnpm tauri:build`           | Packaged installers, sidecar merged in                                                        |
| `pnpm cli:wsl-payload`       | Cross-build the static musl `glimpse-cli` for WSL distros                                     |
| `pnpm perf:baseline`         | Re-measure the README's performance baseline (prerequisites in the script header)             |

The agent gate is `pnpm check && pnpm test && pnpm build` (`verify` in `.tituskirch-skills.json`). CI additionally runs `cargo clippy -D warnings`, `cargo test` and `pnpm tauri build` on the three-OS matrix.

## Conventions

- **Node 24, pnpm 12**, pinned via `.nvmrc`, `engines` and `packageManager`. `pnpm-workspace.yaml` sets `minimumReleaseAge: 4320` and the isolated linker; don't loosen them.
- **Typecheck runs three times** because the `types` sets are mutually exclusive (Vitest vs `mocha` + `@wdio/globals`); don't merge the tsconfigs. `vue-tsc` rides TypeScript 6 through volar's shim fallback (`lib/_tsc.js`), so recheck that path when upgrading either.
- **oxc, not eslint/prettier:** `.oxlintrc.json` (`unicorn` + `oxc`, minimal rules), `.oxfmtrc.json`.
- **Husky** runs `lint-staged` (config in `lint-staged.config.js`; oxfmt ignores are read from `.oxfmtrc.json`) and `commitlint` (`@commitlint/config-conventional`). Never `--no-verify` unless asked.
- **release-please** (`release-please-config.json`, `.release-please-manifest.json`) runs through the kirchDev reusable workflow and also bumps the Cargo and Tauri versions listed in `extra-files`.
- **Workflows:** first-party `actions/*` stay on major tags. Third-party actions and `kirchDev/workflows` reusable workflows are SHA-pinned with a version comment. CodeQL also runs through `kirchDev/workflows`.
- **Dependabot** targets `dev` with a 3-day cooldown: npm and cargo weekly, actions monthly. Minor/patch updates are grouped per ecosystem; majors come separately. The limit-0 entries without `target-branch` keep `main` to security updates.
- **READMEs and meta files** follow the `/write-readme` skill: a centred hero block, the prescribed section emojis (✨ Features, 🚀 Setup, 🤝 Contributing, 🛣️ Versioning, 📄 License), GitHub callouts instead of plain blockquotes, and the license footer `[MIT](LICENSE) © [Titus Kirch](https://github.com/TitusKirch/) / [IT-Dienstleistungen Titus Kirch](https://kirch.dev)`.
