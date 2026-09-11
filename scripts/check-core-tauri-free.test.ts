import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Driven through `node` for the same reason as check-bundle-globals: the
// interface CI uses IS the command line, and running the TypeScript file with
// no loader proves it stayed inside Node's erasable-syntax subset.
//
// A guard that cannot fail and a guard that cannot pass are equally worthless,
// so every case below pins one side of that: the tree this workspace actually
// has must pass, and a tree with Tauri in it must fail. The first case is the
// regression that put this file here — the previous guard grepped whole lines
// for `tauri`, and `cargo tree`'s first line is the crate itself with its
// absolute manifest path, which in this repo lives under `src-tauri/`.
const SCRIPT = fileURLToPath(
  new URL('./check-core-tauri-free.ts', import.meta.url)
);

// The real `cargo tree --package glimpse-core --edges normal,build` output,
// trimmed to its shape: root line with the `src-tauri` path, then the three
// declared dependencies and a few transitives.
const TAURI_FREE_TREE = `glimpse-core v0.13.0 (/home/x/glimpse/src-tauri/crates/glimpse-core)
├── serde v1.0.229
│   ├── serde_core v1.0.229
│   └── serde_derive v1.0.229 (proc-macro)
│       └── syn v3.0.5
├── serde_json v1.0.151
│   └── itoa v1.0.18
└── ts-rs v12.0.1
    └── thiserror v2.0.20
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'glimpse-tauri-free-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function check(tree: string) {
  const file = join(dir, 'tree.txt');
  writeFileSync(file, tree, 'utf8');
  const result = spawnSync(process.execPath, [SCRIPT, file], {
    encoding: 'utf8'
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

describe('check-core-tauri-free', () => {
  it('passes the tree this workspace actually has, path and all', () => {
    const result = check(TAURI_FREE_TREE);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Tauri-free');
  });

  it('fails when Tauri is a direct dependency, and names it', () => {
    const result = check(
      TAURI_FREE_TREE.replace(
        '└── ts-rs v12.0.1',
        '├── tauri v2.9.1\n└── ts-rs v12.0.1'
      )
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tauri v2.9.1');
  });

  it('fails on a Tauri crate dragged in transitively', () => {
    // The case the in-crate manifest test structurally cannot see: nothing in
    // glimpse-core's own Cargo.toml names Tauri, a helper crate's does.
    const result = check(
      TAURI_FREE_TREE.replace(
        '    └── thiserror v2.0.20',
        '    └── tauri-utils v2.7.0'
      )
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tauri-utils v2.7.0');
  });

  it('does not read a package name out of a sibling crate path', () => {
    // Every path dependency inside this workspace carries `src-tauri` in its
    // manifest path. Matching the package name rather than the line is what
    // keeps that out of the report.
    const result = check(
      TAURI_FREE_TREE.replace(
        '└── ts-rs v12.0.1',
        '├── glimpse-shared v0.13.0 (/home/x/glimpse/src-tauri/crates/glimpse-shared)\n└── ts-rs v12.0.1'
      )
    );

    expect(result.status).toBe(0);
  });

  it('does not flag a package whose name merely contains tauri', () => {
    const result = check(
      TAURI_FREE_TREE.replace(
        '└── ts-rs v12.0.1',
        '├── nontauri-helper v1.0.0\n└── ts-rs v12.0.1'
      )
    );

    expect(result.status).toBe(0);
  });

  it('fails rather than passing on an empty tree', () => {
    const result = check('\n');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to');
  });

  it('fails rather than passing when the tree cannot be read', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, join(dir, 'missing.txt')],
      { encoding: 'utf8' }
    );

    expect(result.status).toBe(1);
  });
});

// Every case above hands the script fixture text, which pins what it DECIDES
// but never what it RUNS. These pin the invocation instead, against the real
// workspace on disk — no cargo, no toolchain, so they stay unit-test cheap.
// The three ways it could silently measure the wrong graph are a wrong package,
// a wrong `--edges` and a wrong cwd; one case each.
describe('check-core-tauri-free: the cargo tree invocation', () => {
  const invocation = (() => {
    const result = spawnSync(process.execPath, [SCRIPT, '--print-command'], {
      encoding: 'utf8'
    });
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout) as {
      command: string;
      args: string[];
      cwd: string;
    };
  })();

  it('runs cargo tree from a directory that really is the workspace root', () => {
    expect(invocation.command).toBe('cargo');
    expect(invocation.args[0]).toBe('tree');

    const manifest = readFileSync(join(invocation.cwd, 'Cargo.toml'), 'utf8');
    expect(manifest).toContain('[workspace]');
  });

  it('names a package the workspace actually contains', () => {
    const pkg = invocation.args[invocation.args.indexOf('--package') + 1];
    expect(pkg).toBeTruthy();

    // The crate has to exist AND own that name — a renamed directory or a
    // renamed package would otherwise leave the guard scanning nothing.
    const crate = readFileSync(
      join(invocation.cwd, 'crates', pkg!, 'Cargo.toml'),
      'utf8'
    );
    expect(crate).toContain(`name = "${pkg}"`);

    // And it must be a member, or `cargo tree` resolves a different graph.
    const workspace = readFileSync(join(invocation.cwd, 'Cargo.toml'), 'utf8');
    expect(workspace).toContain(`crates/${pkg}`);
  });

  it('asks for build edges too, where a tauri-build would hide', () => {
    const edges = invocation.args[invocation.args.indexOf('--edges') + 1];
    const kinds = (edges ?? '').split(',');

    // `normal` alone would miss `tauri-build` in `[build-dependencies]` — the
    // exact dependency the GUI package declares — and report a false pass.
    expect(kinds).toContain('normal');
    expect(kinds).toContain('build');
    // `dev` would fail the guard on a dev-dependency the crate never links.
    expect(kinds).not.toContain('dev');
  });
});
