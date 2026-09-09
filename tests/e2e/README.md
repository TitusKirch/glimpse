# End-to-end tests

The toolchain is wired: `pnpm e2e` builds nothing itself but launches the built
desktop binary through [`tauri-driver`](https://crates.io/crates/tauri-driver)
and drives the real UI with WebdriverIO.

Tauri speaks the [WebDriver](https://v2.tauri.app/develop/tests/webdriver/)
protocol through `tauri-driver`, which sits between a WebDriver client (here
WebdriverIO) and the platform driver — `WebKitWebDriver` on Linux,
`msedgedriver` on Windows. There is no macOS support at all, on any version.

## One-time setup

```bash
cargo install tauri-driver --locked
sudo apt-get install -y webkit2gtk-driver xvfb   # provides WebKitWebDriver
pnpm install
```

## Running locally

```bash
pnpm tauri build --debug --no-bundle   # produces the binary the suite drives
xvfb-run --auto-servernum pnpm e2e     # headless
```

`pnpm e2e` is deliberately **outside `pnpm check`**: `check` is the fast gate
(lint, format, typecheck, cargofmt, unit tests) and must not grow a
build-and-launch step. The spec itself is still held to the repo's standards
there — `oxlint` covers it like any other file, and `pnpm typecheck` runs
`vue-tsc` over `tests/e2e/tsconfig.json`.

> [!TIP]
> Quit any running glimpse first. `tauri-plugin-single-instance` hands a second
> launch to the window already open, so the driver gets a process that exits
> immediately. `dbus-run-session -- …` isolates a run if you would rather not
> close it.

## What `wdio.conf.ts` takes care of

- **Deriving the binary path** from `cargo metadata` plus the Tauri
  `productName`, rather than hard-coding it — #103 moves the artefact when it
  splits `src-tauri` into a workspace.
- **A throwaway XDG profile per run.** glimpse persists its open tabs and the
  selected tab; without this, whatever you last did by hand would decide whether
  the suite passes.
- **Cutting off the network.** This one is load-bearing rather than hygiene:
  glimpse checks for updates on launch and installs what it finds, and the
  manifest URLs are compiled into `updater_endpoint()` in Rust, so no config
  override redirects them. On Linux an install rewrites the running AppImage in
  place — so a real run downloads the newest published release straight over
  `target/debug/glimpse`, and the binary under test is silently replaced by a
  different version mid-suite. Any branch whose version trails the latest
  release (the normal state of `dev`) hits this every time. Pointing the proxy
  variables at a closed port stops it; loopback stays exempt, because
  WebKitWebDriver reaches the app over a local socket and honours those same
  variables.

## In CI

The `E2E smoke test` job in `.github/workflows/ci.yml` runs it on
`ubuntu-latest` only. `tauri-driver` has no macOS support at all, and the
Windows leg needs a matching `msedgedriver` — that one is a follow-up, not a
gap. The job is listed in `tauri-gate`'s `needs`, so a failure here cannot pass
the merge button by leaving the gate green.

## What to cover next

- launch → a repo opens and the commit graph renders (`smoke.spec.ts`)
- open the command palette (Ctrl+K) and switch branch
- stage a file and commit; assert it appears at the top of the graph

