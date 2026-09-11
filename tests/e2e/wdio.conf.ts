// WebdriverIO config for the end-to-end smoke test. See ./README.md for the
// one-time setup and how to run this locally.
//
// Tauri has no WebDriver of its own: `tauri-driver` sits between this client and
// the platform WebDriver (WebKitWebDriver on Linux, msedgedriver on Windows) and
// launches the built binary for each session. It ships as a cargo binary rather
// than an npm package, so it is spawned here instead of being pulled in as a
// wdio service.

import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(e2eDir, '..', '..');
const manifestPath = join(repoRoot, 'src-tauri', 'Cargo.toml');

// The suite drives the `--debug` binary: it is the same code path as a release
// build but compiles in a fraction of the time, which is what keeps this job
// affordable in CI.
const PROFILE = 'debug';

type CargoTarget = { name: string; kind: string[] };
type CargoPackage = { targets: CargoTarget[] };
type CargoMetadata = { packages: CargoPackage[]; target_directory: string };

/**
 * Absolute path of the built desktop binary.
 *
 * Derived, never hard-coded: #103 splits `src-tauri` into a core + GUI + CLI
 * workspace, which moves the artefact. `cargo metadata` reports the real target
 * directory (honouring `CARGO_TARGET_DIR` and any workspace layout), and the
 * file on disk is named after either the Tauri `productName` or the crate's own
 * `[[bin]]` target depending on the Tauri version — so both are tried.
 */
function resolveApplication(): string {
  const meta = spawnSync(
    'cargo',
    [
      'metadata',
      '--no-deps',
      '--format-version',
      '1',
      '--manifest-path',
      manifestPath
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (meta.status !== 0) {
    throw new Error(
      `cargo metadata failed (${meta.status}): ${meta.stderr || meta.error?.message}`
    );
  }

  const metadata = JSON.parse(meta.stdout) as CargoMetadata;
  const binNames = metadata.packages.flatMap((pkg) =>
    pkg.targets.filter((t) => t.kind.includes('bin')).map((t) => t.name)
  );
  const { productName } = JSON.parse(
    readFileSync(join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8')
  ) as { productName?: string };

  const suffix = process.platform === 'win32' ? '.exe' : '';
  const names = [...new Set([productName, ...binNames].filter(Boolean))];
  const candidates = names.map((name) =>
    join(metadata.target_directory, PROFILE, `${name}${suffix}`)
  );

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `No ${PROFILE} binary found. Looked for:\n  ${candidates.join('\n  ')}\n` +
        'Build it first: pnpm tauri build --debug --no-bundle'
    );
  }
  return found;
}

// A throwaway XDG home per run. glimpse persists its open tabs and layout (so
// which tab is selected on launch) via localStorage under the app's data dir —
// without this the suite would inherit whatever the last real run left behind,
// and a developer's own session would decide whether it passes.
let profileDir: string | undefined;
let tauriDriver: ChildProcess | undefined;

/**
 * Environment for the app under test: a private profile, and nothing else.
 *
 * Nothing here holds the updater off any more, and nothing here needs to.
 * `updater_allowed()` in `src-tauri/src/lib.rs` shuts it for every debug build,
 * this one included — so `pnpm tauri dev` is covered by the same gate, instead
 * of only this suite being covered by a mechanism living in a file nobody would
 * think to look in. The suite sets no `GLIMPSE_ALLOW_UPDATER`, so the gate stays
 * shut here.
 *
 * What that stops: glimpse updates in place, and on Linux an install rewrites
 * the running AppImage — so a build whose version trails the newest release
 * downloads that release straight over `target/debug/glimpse` on launch, and the
 * binary under test is replaced by a different version mid-suite.
 */
function appEnv(profile: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    XDG_DATA_HOME: join(profile, 'data'),
    XDG_CONFIG_HOME: join(profile, 'config'),
    XDG_CACHE_HOME: join(profile, 'cache')
  };
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: [join(e2eDir, 'smoke.spec.ts')],
  maxInstances: 1,

  capabilities: [
    {
      browserName: 'wry',
      // WebdriverIO 9 negotiates WebDriver BiDi by default, which means asking
      // for `webSocketUrl` in alwaysMatch. WebKitWebDriver speaks only classic
      // WebDriver and rejects the whole session over it ("Failed to match
      // capabilities"), so BiDi has to be turned off explicitly.
      'wdio:enforceWebDriverClassic': true,
      // @ts-expect-error `tauri:options` is tauri-driver's own capability and is
      // not part of the upstream WebdriverIO capability types.
      'tauri:options': {
        application: resolveApplication(),
        // `glimpse <path>` — the CLI entry point. Opening the repo explicitly
        // beats relying on the process CWD, which the app would otherwise fall
        // back to.
        args: [repoRoot]
      }
    }
  ],

  // tauri-driver's own port; it proxies to the platform WebDriver behind it.
  hostname: '127.0.0.1',
  port: 4444,
  path: '/',

  logLevel: 'warn',
  framework: 'mocha',
  reporters: ['spec'],
  // A cold launch compiles nothing but still has to boot the webview, hydrate
  // the SPA and shell out to git, so the per-test budget is generous.
  mochaOpts: { ui: 'bdd', timeout: 120_000 },

  onPrepare() {
    profileDir = mkdtempSync(join(tmpdir(), 'glimpse-e2e-'));
    // tauri-driver launches the app itself, so the app inherits this env.
    tauriDriver = spawn('tauri-driver', [], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: appEnv(profileDir)
    });
    tauriDriver.on('error', (error) => {
      console.error('tauri-driver failed to start:', error);
      process.exit(1);
    });
  },

  onComplete() {
    tauriDriver?.kill();
    if (profileDir) rmSync(profileDir, { recursive: true, force: true });
  }
};
