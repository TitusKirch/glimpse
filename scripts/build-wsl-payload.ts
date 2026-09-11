#!/usr/bin/env node
// THE NATIVE COMMAND LINE FOR A WSL DISTRO (#103, criterion (c)'s second half).
//
// `scripts/glimpse-wsl.sh` — the launcher the Windows app drops into every
// installed distro — routes a subcommand to a NATIVE Linux `glimpse-cli` when
// the distro has one, and forwards it to `glimpse.exe` over the
// `\\wsl.localhost` share when it does not. Until now no installer ever shipped
// a Linux binary, so the native leg was unreachable on a distro with no glimpse
// package of its own: every `glimpse status` took the long way round.
//
// This script builds that binary and stages it as a Tauri RESOURCE, so the
// Windows installer carries it and `install_wsl_cli_into` (src-tauri/src/lib.rs)
// can stream it into each distro at the first path the launcher searches.
//
// WHY MUSL, NOT GNU. The payload runs inside whatever distro the user happens
// to have — Ubuntu 22.04, Debian 12, Alpine, a decade-old image. A glibc build
// is bound to the glibc of the machine that produced it and dies with
// `GLIBC_2.39 not found` on anything older; a static musl build has no such
// edge. `glimpse-cli` depends on serde, serde_json and ts-rs and links no C
// library of its own, so static is free.
//
// WHY A RESOURCE, NOT A SECOND SIDECAR. `bundle.externalBin` matches the
// BUILD's target triple — that is how `glimpse-cli-<triple>` gets picked — so
// a Linux binary can never be a sidecar of a Windows build. A resource is
// copied verbatim, which is exactly what a payload for another operating
// system needs.
//
// WHY IT IS ARCH-KEYED AND NOT TRIPLE-KEYED. The distro answers `uname -m`,
// and that is all it can answer cheaply; the Rust side turns `x86_64` into
// this file's name. An ARM64 Windows host runs ARM64 distros and finds no
// payload — which is not a failure, it is the forwarding route, unchanged.
//
// WHERE THE BYTES COME FROM ON A WINDOWS RUNNER. There is no Linux linker
// there, so the payload is built once on a Linux runner and handed to the
// Windows side as an artifact; `--from <file>` stages that file instead of
// building. The two routes stage the identical name, which is the only thing
// the bundler and the installer agree on. The release chain
// (`_tauri-build.yml`) unpacks its artifact straight into the staging
// directory and needs no flag; `wsl-smoke.yml`'s Windows job is what passes
// `--from`, because it downloads the payload to a directory of its own and
// then asks this script for the canonical name and place.
//
// Usage: pnpm cli:wsl-payload -- [--from <file>] [--print-plan]
//   (or `node scripts/build-wsl-payload.ts` directly — which is what the
//    release chain's Linux job runs, because it sets up no pnpm at all)
//   --from <file>  — stage this prebuilt ELF instead of building one (CI's
//                    artifact hand-off; there is no Linux toolchain on the
//                    Windows runner that needs the payload)
//   --print-plan   — print the plan as JSON and exit, building nothing

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STAGE_DIR } from './build-cli-sidecar.ts';

const WORKSPACE = fileURLToPath(new URL('../src-tauri', import.meta.url));
const PACKAGE = 'glimpse-cli';

// The one triple shipped today. Static, so it runs in any distro; `x86_64`
// because that is what WSL2 on an x64 Windows host presents, and an ARM64 host
// keeps the forwarding route rather than getting a binary it cannot run.
export const PAYLOAD_TRIPLE = 'x86_64-unknown-linux-musl';

// The merge patch that turns the payload on, relative to tauri.conf.json's
// directory. A SUPERSET of `tauri.sidecar.conf.json` — it re-declares the
// sidecar — so the Windows leg passes this one file and nothing has to merge
// two fragments at build time. The test pins the two declarations together.
export const PAYLOAD_CONFIG = 'tauri.wsl-payload.conf.json';

// `uname -m` is the distro's answer, so the file is named by machine and not by
// triple: `wsl_payload_name` in src-tauri/src/lib.rs builds this same string
// from what the distro reports, and a cargo test pins the spelling.
export function machineOf(triple: string): string {
  const arch = triple.split('-')[0];
  if (arch === undefined || arch === '')
    throw new Error(`no architecture in triple: ${triple}`);
  return arch;
}

export function payloadName(triple: string): string {
  return `${PACKAGE}-linux-${machineOf(triple)}`;
}

type Plan = {
  triple: string;
  build: { command: string; args: string[]; cwd: string };
  source: string;
  target: string;
};

export function payloadPlan(triple: string): Plan {
  return {
    triple,
    build: {
      command: 'cargo',
      args: [
        'build',
        '--manifest-path',
        join(WORKSPACE, 'Cargo.toml'),
        '--package',
        PACKAGE,
        '--target',
        triple,
        '--release'
      ],
      cwd: WORKSPACE
    },
    // `--target` moves the output under `target/<triple>/`. Reading the native
    // path instead would stage the HOST binary under the payload's name, and
    // the distro would get an ELF it cannot run with nothing to say why.
    source: join(WORKSPACE, 'target', triple, 'release', PACKAGE),
    target: join(WORKSPACE, STAGE_DIR, payloadName(triple))
  };
}

function main() {
  const argv = process.argv.slice(2);
  const fromFlag = argv.indexOf('--from');
  const fromValue = fromFlag === -1 ? undefined : argv[fromFlag + 1];
  // A FLAG WITH NO VALUE IS A MISTAKE, NOT A DEFAULT. `--from` with nothing
  // after it used to fall back to building — and on the one runner that passes
  // it, a Windows one, there is no Linux linker, so the fallback could only
  // fail obscurely minutes later or, worse, stage a binary built for the wrong
  // operating system. Say it here, where the argv is still in hand.
  if (
    fromFlag !== -1 &&
    (fromValue === undefined || fromValue.startsWith('-'))
  ) {
    console.error(
      'build-wsl-payload: --from needs a path to a prebuilt ELF ' +
        '(e.g. --from ./glimpse-cli-linux-x86_64)'
    );
    process.exit(1);
  }
  const from = fromValue === undefined ? undefined : resolve(fromValue);
  const p = payloadPlan(PAYLOAD_TRIPLE);

  if (argv.includes('--print-plan')) {
    console.log(JSON.stringify({ ...p, from: from ?? null }));
    return;
  }

  if (from === undefined) {
    const built = spawnSync(p.build.command, p.build.args, {
      cwd: p.build.cwd,
      stdio: 'inherit'
    });
    if (built.status !== 0) {
      console.error(
        `build-wsl-payload: \`cargo build\` failed (status ${built.status}). ` +
          `Is the ${PAYLOAD_TRIPLE} target installed (rustup target add ` +
          `${PAYLOAD_TRIPLE}) and musl-tools present?`
      );
      process.exit(1);
    }
  }

  const source = from ?? p.source;
  mkdirSync(join(WORKSPACE, STAGE_DIR), { recursive: true });
  try {
    copyFileSync(source, p.target);
  } catch (error) {
    console.error(
      `build-wsl-payload: cannot stage ${source} as ${p.target}: ${String(error)}`
    );
    process.exit(1);
  }
  // Cosmetic on the Windows runner that actually ships this — NTFS carries no
  // mode, and the installer inside the distro chmods after `cat` for exactly
  // that reason. It matters on a Linux dev machine building the fragment.
  chmodSync(p.target, 0o755);
  console.log(`build-wsl-payload: staged ${p.target}`);
}

// Importable for the test, runnable as the script CI calls.
const invoked = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) main();
