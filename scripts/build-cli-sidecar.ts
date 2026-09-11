#!/usr/bin/env node
// THE COMMAND LINE, PACKAGED (#103, criterion (c)'s shipping half).
//
// `glimpse-cli` is a second binary in the same workspace, and until now nothing
// put it into an installer. The launcher inside a WSL distro already looks for
// it — a native Linux `glimpse-cli`, or the console `glimpse-cli.exe` beside
// glimpse.exe — and found neither, because no build ever shipped one. This
// script is the missing half: it builds the CLI for the HOST triple and stages
// it where Tauri's `bundle.externalBin` expects a sidecar, so every installer
// the matrix produces carries the command line beside the app.
//
// WHY A SIDECAR RATHER THAN A SECOND BUNDLE. Tauri copies an external binary
// into the same place it puts the app's own: next to `glimpse.exe` on Windows
// (which is exactly where `console_exe` in scripts/glimpse-wsl.sh looks), and
// onto `PATH` as `glimpse-cli` in the Linux packages (where the launcher's PATH
// search finds it). Nothing in the launcher had to change to be shipped to.
//
// WHY `externalBin` IS NOT IN `tauri.conf.json`. It used to be, and that broke
// every plain `cargo` command in the repo: `tauri-build`'s build script
// resolves the declared sidecar on EVERY compile, so `cargo clippy` and `cargo
// test` on a clean checkout failed with `resource path … doesn't exist` — no
// bundling anywhere in sight, and no `pnpm` step to stage one. The declaration
// therefore lives in `src-tauri/tauri.sidecar.conf.json` and is merged in with
// `tauri build --config` at the invocations that stage the file first
// (`pnpm tauri:build`, ci.yml's tauri job, the release chain's tauri-action).
// A build input exists exactly where something produces it, and nowhere else.
//
// THE TRIPLE IN THE FILENAME IS TAURI'S CONTRACT, not decoration:
// `externalBin: ["binaries/glimpse-cli"]` makes the bundler look for
// `binaries/glimpse-cli-<target-triple>` (plus `.exe` on Windows) and strip the
// suffix on the way in. A staged file under any other name is not found, and
// the build fails rather than silently shipping without a command line.
//
// WHY THE PLAN IS PRINTABLE. `--print-plan` exists for the same reason
// check-core-tauri-free's `--print-command` does: the part that can go wrong
// silently is the INVOCATION — the wrong package, the wrong profile directory,
// a staged name Tauri will not match — and a test that only drove the copying
// would pin none of it. Every case in scripts/build-cli-sidecar.test.ts reads
// this plan, so the naming rule is checked without a Rust toolchain in reach.
//
// Usage: node scripts/build-cli-sidecar.ts [--debug] [--host <triple>] [--print-plan]
//   --debug        — stage the dev-profile build (what a `--debug` build wants)
//                    instead of the release one
//   --host <triple>— use this target triple instead of asking `rustc -vV`
//   --print-plan   — print the plan as JSON and exit, building nothing

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE = fileURLToPath(new URL('../src-tauri', import.meta.url));
const PACKAGE = 'glimpse-cli';

// `externalBin` names this path, relative to tauri.conf.json's directory. Both
// halves have to agree, and the test reads them from here and from that file.
export const STAGE_DIR = 'binaries';

// The merge patch that turns the sidecar on, relative to tauri.conf.json's
// directory. Named here so the test can read the declaration out of it rather
// than restating it, the way it used to read it out of tauri.conf.json.
export const SIDECAR_CONFIG = 'tauri.sidecar.conf.json';

type Plan = {
  triple: string;
  profile: 'debug' | 'release';
  build: { command: string; args: string[]; cwd: string };
  source: string;
  target: string;
};

// A Windows host produces `glimpse-cli.exe`, and the staged name keeps the
// extension AFTER the triple — `glimpse-cli-x86_64-pc-windows-msvc.exe` — which
// is the shape Tauri matches. Getting this the other way round is the whole
// reason the rule lives in one function with a test on it.
export function sidecarName(triple: string): string {
  const suffix = triple.includes('windows') ? '.exe' : '';
  return `${PACKAGE}-${triple}${suffix}`;
}

export function binaryName(triple: string): string {
  return triple.includes('windows') ? `${PACKAGE}.exe` : PACKAGE;
}

// `rustc -vV` prints `host: <triple>` — the ONE authority for what this machine
// builds by default. Reading the triple out of `process.platform`/`arch`
// instead would guess at the ABI (gnu vs musl, msvc vs gnu) and guess wrong on
// exactly the machines where it matters.
export function hostTriple(rustcVersion: string): string {
  const line = rustcVersion
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('host:'));
  if (line === undefined) {
    throw new Error('`rustc -vV` printed no `host:` line');
  }
  const triple = line.slice('host:'.length).trim();
  if (triple === '')
    throw new Error('`rustc -vV` printed an empty host triple');
  return triple;
}

export function plan(triple: string, debug: boolean): Plan {
  const profile = debug ? 'debug' : 'release';
  return {
    triple,
    profile,
    build: {
      command: 'cargo',
      args: [
        'build',
        '--manifest-path',
        join(WORKSPACE, 'Cargo.toml'),
        '--package',
        PACKAGE,
        ...(debug ? [] : ['--release'])
      ],
      cwd: WORKSPACE
    },
    // `--release` writes to `target/release`, a dev build to `target/debug`;
    // the workspace has no custom `target-dir`, so both sit under src-tauri.
    source: join(WORKSPACE, 'target', profile, binaryName(triple)),
    target: join(WORKSPACE, STAGE_DIR, sidecarName(triple))
  };
}

function main() {
  const argv = process.argv.slice(2);
  const debug = argv.includes('--debug');
  const hostFlag = argv.indexOf('--host');
  const triple =
    hostFlag !== -1 && argv[hostFlag + 1] !== undefined
      ? (argv[hostFlag + 1] as string)
      : hostTriple(rustcVersion());
  const p = plan(triple, debug);

  if (argv.includes('--print-plan')) {
    console.log(JSON.stringify(p));
    return;
  }

  const built = spawnSync(p.build.command, p.build.args, {
    cwd: p.build.cwd,
    stdio: 'inherit'
  });
  if (built.status !== 0) {
    console.error(
      `build-cli-sidecar: \`cargo build\` failed (status ${built.status}).`
    );
    process.exit(1);
  }

  mkdirSync(join(WORKSPACE, STAGE_DIR), { recursive: true });
  try {
    copyFileSync(p.source, p.target);
  } catch (error) {
    // Naming both paths matters: a miss here means the profile directory and
    // the build disagreed, and the target path alone would not say which.
    console.error(
      `build-cli-sidecar: cannot stage ${p.source} as ${p.target}: ${String(error)}`
    );
    process.exit(1);
  }
  // The copy inherits the source's mode on every platform this runs on, but a
  // stale non-executable file at the target would keep its own — and a sidecar
  // that cannot be executed is a runtime failure inside an installed app.
  chmodSync(p.target, 0o755);
  console.log(`build-cli-sidecar: staged ${p.target}`);
}

function rustcVersion(): string {
  const result = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(
      'build-cli-sidecar: cannot run `rustc -vV` — is the Rust toolchain installed?'
    );
    process.exit(1);
  }
  return result.stdout ?? '';
}

// Importable for the test, runnable as the script CI and the Tauri hooks call.
const invoked = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) main();
