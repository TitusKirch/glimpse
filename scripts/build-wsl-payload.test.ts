import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SIDECAR_CONFIG, STAGE_DIR } from './build-cli-sidecar.ts';
import {
  machineOf,
  PAYLOAD_CONFIG,
  PAYLOAD_TRIPLE,
  payloadName,
  payloadPlan
} from './build-wsl-payload.ts';

// Driven through `node` as well as imported, for the same reason as its
// siblings: the interface CI uses IS the command line, and running the
// TypeScript file with no loader proves it stayed inside Node's
// erasable-syntax subset.
const SCRIPT = fileURLToPath(
  new URL('./build-wsl-payload.ts', import.meta.url)
);

const PAYLOAD_CONF = fileURLToPath(
  new URL(`../src-tauri/${PAYLOAD_CONFIG}`, import.meta.url)
);
const SIDECAR_CONF = fileURLToPath(
  new URL(`../src-tauri/${SIDECAR_CONFIG}`, import.meta.url)
);
const LIB_RS = fileURLToPath(
  new URL('../src-tauri/src/lib.rs', import.meta.url)
);
const LAUNCHER = fileURLToPath(new URL('./glimpse-wsl.sh', import.meta.url));
const WORKFLOWS = fileURLToPath(
  new URL('../.github/workflows', import.meta.url)
);

function printedPlan(args: string[] = []) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--print-plan', ...args],
    {
      encoding: 'utf8'
    }
  );
  expect(result.status, result.stderr ?? '').toBe(0);
  return JSON.parse(result.stdout ?? '');
}

describe('build-wsl-payload', () => {
  it('builds a STATIC binary, because the distro it lands in is unknown', () => {
    // The payload runs inside whatever the user happens to have — Ubuntu 22.04,
    // Debian 12, Alpine. A glibc build carries the glibc of the machine that
    // produced it and dies with `GLIBC_2.xx not found` on anything older, which
    // would make the native route WORSE than the forwarding one it replaces.
    expect(PAYLOAD_TRIPLE).toContain('linux-musl');
    const p = printedPlan();
    expect(p.build.args).toContain('--target');
    expect(p.build.args[p.build.args.indexOf('--target') + 1]).toBe(
      PAYLOAD_TRIPLE
    );
    // `--target` moves the output under `target/<triple>/` — reading the native
    // path would stage the HOST binary under the payload's name.
    expect(p.source).toContain(`/target/${PAYLOAD_TRIPLE}/release/glimpse-cli`);
    expect(p.build.args).toContain('--package');
    expect(p.build.args[p.build.args.indexOf('--package') + 1]).toBe(
      'glimpse-cli'
    );
  });

  it('names the payload by `uname -m`, which is what a distro can answer', () => {
    expect(machineOf('x86_64-unknown-linux-musl')).toBe('x86_64');
    expect(machineOf('aarch64-unknown-linux-musl')).toBe('aarch64');
    expect(payloadName(PAYLOAD_TRIPLE)).toBe('glimpse-cli-linux-x86_64');
  });

  it('stages exactly what the payload config fragment declares', () => {
    // THE GUARD. The script decides the staged path, the bundler decides what
    // it copies, and neither knows about the other — a rename on either side
    // ships a Windows installer with no WSL command line in it and stays green.
    const conf = JSON.parse(readFileSync(PAYLOAD_CONF, 'utf8'));
    const resources: Record<string, string> = conf.bundle?.resources ?? {};
    const p = payloadPlan(PAYLOAD_TRIPLE);
    const staged = `${STAGE_DIR}/${basename(p.target)}`;
    expect(Object.keys(resources)).toContain(staged);
    expect(basename(dirname(p.target))).toBe(STAGE_DIR);
    // The destination is a bare filename, so the resource lands beside
    // glimpse.exe — which is the directory `install_wsl_cli_into` reads.
    expect(resources[staged]).toBe(basename(p.target));
  });

  it('re-declares the sidecar, so the Windows leg passes ONE fragment', () => {
    // Two `--config` fragments would have to be merged at build time, on a
    // matrix leg, in YAML. This file is a superset instead — and the price of
    // a superset is that it can drift from what it supersets, which is this.
    const payload = JSON.parse(readFileSync(PAYLOAD_CONF, 'utf8'));
    const sidecar = JSON.parse(readFileSync(SIDECAR_CONF, 'utf8'));
    expect(payload.bundle?.externalBin).toEqual(sidecar.bundle?.externalBin);
  });

  it('agrees with the Rust side about the payload name', () => {
    // `wsl_payload_name` builds the same string from what the distro reports.
    // Nothing links the two languages, and a mismatch is silent: the installer
    // ships a file the installer-side lookup never asks for.
    const lib = readFileSync(LIB_RS, 'utf8');
    expect(lib).toContain('format!("glimpse-cli-linux-{machine}")');
    // …and the launcher searches the path the Rust side writes to. That pairing
    // is pinned on the Rust side too; here it is the third corner, so a rename
    // cannot pass by moving two of the three.
    expect(readFileSync(LAUNCHER, 'utf8')).toContain(
      '/usr/local/lib/glimpse/glimpse-cli'
    );
  });

  it('can stage a prebuilt ELF instead of building one', () => {
    // The Windows runner that needs the payload has no Linux linker, so the
    // release chain builds it on a Linux runner and hands it over as an
    // artifact. Same staged name either way — that is the only thing the
    // bundler and the installer agree on.
    const p = printedPlan(['--from', '/tmp/glimpse-cli']);
    expect(p.from).toBe('/tmp/glimpse-cli');
    expect(p.target).toBe(printedPlan().target);
  });

  it('merges the payload fragment into the chain that ships installers', () => {
    // THE OTHER HALF, exactly as for the sidecar: forgetting `--config` here
    // produces a Windows installer with no WSL command line, silently, once
    // per tag, watched by nobody. `tauri-action` is the release chain's
    // bundler and the only invocation that uploads installers to a release.
    const steps = (yaml: string) =>
      yaml.split(/^\s*- (?:name|uses):/m).map((step) =>
        step
          .split('\n')
          .filter((line) => !/^\s*#/.test(line))
          .join('\n')
      );

    const shipping: { where: string; body: string }[] = [];
    for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml')))
      for (const body of steps(readFileSync(join(WORKFLOWS, file), 'utf8')))
        if (/tauri-apps\/tauri-action/.test(body))
          shipping.push({
            where: `${file}: ${body.split('\n')[0]?.trim() ?? ''}`,
            body
          });

    // A guard that matches nothing passes for free — name the count first.
    expect(shipping.length).toBeGreaterThan(0);
    for (const step of shipping)
      expect(step.body, step.where).toContain(PAYLOAD_CONFIG);
  });
});
