import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  hostTriple,
  plan,
  SIDECAR_CONFIG,
  sidecarName,
  STAGE_DIR
} from './build-cli-sidecar.ts';

// Driven through `node` as well as imported, for the same reason as
// check-core-tauri-free and check-bundle-globals: the interface the Tauri hooks
// and CI use IS the command line, and running the TypeScript file with no
// loader is what proves it stayed inside Node's erasable-syntax subset.
const SCRIPT = fileURLToPath(
  new URL('./build-cli-sidecar.ts', import.meta.url)
);

const TAURI_CONF = fileURLToPath(
  new URL('../src-tauri/tauri.conf.json', import.meta.url)
);

const SIDECAR_CONF = fileURLToPath(
  new URL(`../src-tauri/${SIDECAR_CONFIG}`, import.meta.url)
);

const WORKFLOWS = fileURLToPath(
  new URL('../.github/workflows', import.meta.url)
);

const PACKAGE_JSON = fileURLToPath(new URL('../package.json', import.meta.url));

function printedPlan(args: string[]) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--print-plan', ...args],
    { encoding: 'utf8' }
  );
  expect(result.status, result.stderr ?? '').toBe(0);
  return JSON.parse(result.stdout ?? '');
}

describe('build-cli-sidecar', () => {
  it('reads the host triple out of `rustc -vV`, not out of process.platform', () => {
    // The real shape, verbatim — the guess-from-Node alternative cannot tell
    // msvc from gnu or gnu from musl, which is the whole reason rustc answers.
    const version = `rustc 1.96.0 (ac68faa20 2026-05-25)
binary: rustc
commit-hash: ac68faa20c58cbccd01ee7208bf3b6e93a7d7f96
host: x86_64-unknown-linux-gnu
release: 1.96.0
`;
    expect(hostTriple(version)).toBe('x86_64-unknown-linux-gnu');
  });

  it('refuses a `rustc -vV` that names no host rather than staging a guess', () => {
    expect(() => hostTriple('rustc 1.96.0\nrelease: 1.96.0\n')).toThrow(
      'host:'
    );
  });

  it('puts the .exe after the triple, which is the name Tauri matches', () => {
    // `glimpse-cli-x86_64-pc-windows-msvc.exe`, never
    // `glimpse-cli.exe-x86_64-…`: the bundler strips `-<triple>` from the stem
    // and would find nothing under the other spelling — a Windows installer
    // shipping no command line, with a green build behind it.
    expect(sidecarName('x86_64-pc-windows-msvc')).toBe(
      'glimpse-cli-x86_64-pc-windows-msvc.exe'
    );
    expect(sidecarName('x86_64-unknown-linux-gnu')).toBe(
      'glimpse-cli-x86_64-unknown-linux-gnu'
    );
    expect(sidecarName('aarch64-apple-darwin')).toBe(
      'glimpse-cli-aarch64-apple-darwin'
    );
  });

  it('stages exactly where the sidecar config fragment says it looks', () => {
    // THE GUARD, and it runs in both directions: the script decides the path,
    // the bundler decides the path, and neither knows about the other. A
    // renamed directory or package on either side lands here instead of in a
    // release that installs no `glimpse-cli`.
    const conf = JSON.parse(readFileSync(SIDECAR_CONF, 'utf8'));
    const external: string[] = conf.bundle?.externalBin ?? [];
    expect(external).toContain(`${STAGE_DIR}/glimpse-cli`);

    const staged = plan('x86_64-unknown-linux-gnu', false);
    expect(basename(dirname(staged.target))).toBe(STAGE_DIR);
    for (const declared of external) {
      expect(basename(staged.target).startsWith(`${basename(declared)}-`)).toBe(
        true
      );
    }
  });

  it('keeps the sidecar out of the config a bare `cargo` build reads', () => {
    // THE REGRESSION THIS FILE EXISTS TO STOP. `bundle.externalBin` in
    // `tauri.conf.json` is not a bundling detail — `tauri-build`'s build script
    // resolves it on every compile, so a declared sidecar that nothing staged
    // fails `cargo clippy` and `cargo test` on a clean checkout, for everyone,
    // with no bundle anywhere in sight. It lives in the fragment above instead,
    // merged in with `--config` exactly where something stages it first.
    const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
    expect(conf.bundle?.externalBin).toBeUndefined();
  });

  it('merges the fragment into every invocation that produces a bundle', () => {
    // THE OTHER HALF OF THE SPLIT. Moving `externalBin` out of the checked-in
    // config bought a green `cargo test` at the price of a new silent failure:
    // an invocation that BUNDLES and forgets `--config` ships installers with
    // no command line in them, and nothing goes red — the release chain least
    // of all, which runs once per tag and is watched by nobody at 3am.
    //
    // A `--no-bundle` compile is exempt on purpose: it produces no installer,
    // so declaring the sidecar there only buys a CLI build. `ci.yml`'s matrix
    // opts in anyway, because resolving the name on all three platforms is the
    // only Windows evidence this repo can produce without a Windows machine.
    const steps = (yaml: string) =>
      yaml.split(/^\s*- (?:name|uses):/m).map((step) =>
        step
          .split('\n')
          .filter((line) => !/^\s*#/.test(line))
          .join('\n')
      );

    const bundling: { where: string; body: string }[] = [];
    for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml')))
      for (const body of steps(readFileSync(join(WORKFLOWS, file), 'utf8'))) {
        const builds =
          /tauri build/.test(body) || /tauri-apps\/tauri-action/.test(body);
        if (builds && !body.includes('--no-bundle'))
          bundling.push({
            where: `${file}: ${body.split('\n')[0]?.trim() ?? ''}`,
            body
          });
      }

    // A guard that matches nothing passes for free — name the count first.
    expect(bundling.length).toBeGreaterThan(0);
    for (const step of bundling)
      expect(step.body, step.where).toContain(SIDECAR_CONFIG);

    // The local route is the same rule: `pnpm tauri build` is a compile with no
    // command line in it, `pnpm tauri:build` is the one that packages.
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
    expect(pkg.scripts['tauri:build']).toContain(SIDECAR_CONFIG);
  });

  it('takes the release build from target/release and the debug one from target/debug', () => {
    // The two profiles write to different directories, and the sidecar name is
    // the same for both — so reading the wrong one ships a debug binary in a
    // release installer, or fails to find anything at all.
    const release = printedPlan(['--host', 'x86_64-unknown-linux-gnu']);
    expect(release.profile).toBe('release');
    expect(release.build.args).toContain('--release');
    expect(release.source).toContain('/target/release/glimpse-cli');

    const debug = printedPlan([
      '--host',
      'x86_64-unknown-linux-gnu',
      '--debug'
    ]);
    expect(debug.profile).toBe('debug');
    expect(debug.build.args).not.toContain('--release');
    expect(debug.source).toContain('/target/debug/glimpse-cli');
    expect(debug.target).toBe(release.target);
  });

  it('builds the CLI package out of the workspace, not the GUI one', () => {
    // A `cargo build` without `--package` in this workspace builds the default
    // members — the Tauri GUI included — which on a runner with no WebView
    // toolchain fails for a reason that has nothing to do with the CLI.
    const p = printedPlan(['--host', 'x86_64-pc-windows-msvc']);
    expect(p.build.command).toBe('cargo');
    expect(p.build.args).toContain('--package');
    expect(p.build.args[p.build.args.indexOf('--package') + 1]).toBe(
      'glimpse-cli'
    );
    expect(p.build.cwd.endsWith('src-tauri')).toBe(true);
    expect(p.source.endsWith('glimpse-cli.exe')).toBe(true);
  });
});
