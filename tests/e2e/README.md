# End-to-end tests (scaffold)

> [!IMPORTANT]
> This is a **scaffold**, not a wired-up suite. Tauri E2E needs `tauri-driver`
> plus the platform WebDriver (`WebKitWebDriver` on Linux, `msedgedriver` on
> Windows) and a **bundled** debug binary. It can't run in the headless Linux/
> WSL dev shell used so far, so it is intentionally left out of CI for now.

Tauri drives the app through the [WebDriver](https://v2.tauri.app/develop/tests/webdriver/)
protocol via [`tauri-driver`](https://crates.io/crates/tauri-driver), which sits
between a WebDriver client (here WebdriverIO) and the platform driver.

## One-time setup

```bash
cargo install tauri-driver --locked
# Linux: provides WebKitWebDriver
sudo apt-get install -y webkit2gtk-driver xvfb
pnpm add -D @wdio/cli @wdio/local-runner @wdio/mocha-framework
```

## Running locally

```bash
pnpm tauri build --debug            # produces the binary smoke.spec drives
xvfb-run pnpm wdio run tests/e2e/wdio.conf.ts   # headless on Linux
```

## What to cover first

- launch → a repo opens (CWD) and the commit graph renders
- open the command palette (Ctrl+K) and switch branch
- stage a file and commit; assert it appears at the top of the graph

`smoke.spec.ts` sketches the first of these. Wire `wdio.conf.ts` to point
`capabilities['tauri:options'].application` at the built debug binary, then add
a `test:e2e` script and a separate (self-hosted or matrix) CI job once a target
machine is available.
