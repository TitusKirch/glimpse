#!/usr/bin/env node
// THE TAURI-FREE CLAIM, MEASURED (#103).
//
// `glimpse-core` carries the git engine so the CLI can run it with no desktop
// anywhere in reach — a promise that holds only as long as nothing drags Tauri
// back in, and one nobody notices breaking, because the GUI build stays green
// either way. `cargo tree` is what settles it, and the whole *transitive* graph
// is the point: the unit test in the crate reads its own manifest, which
// catches a direct dependency and nothing else. A helper crate that innocently
// depends on tauri would slip straight past it and be caught here.
//
// This lives in a script rather than three lines of shell in the workflow
// because the first attempt was three lines of shell in the workflow, and it
// grepped whole lines for `tauri`:
//
//     glimpse-core v0.13.0 (/…/glimpse/src-tauri/crates/glimpse-core)
//
// `cargo tree`'s first line is the crate itself with its absolute manifest
// path, and this workspace's root directory is literally named `src-tauri`. The
// guard therefore matched on every run, on every machine, and would have turned
// the next pull request red for a reason unrelated to the change in it. Nothing
// caught it because `ci.yml` runs on `pull_request` and the work landed on a
// shared branch, so the step had never once executed.
//
// The lesson is the shape, not the regex: a guard that cannot fail and a guard
// that cannot pass are equally worthless, and neither is visible by reading it.
// So the decision half is here, where `scripts/check-core-tauri-free.test.ts`
// pins BOTH sides of it — this workspace's real tree passes, a tree with Tauri
// in it fails — and `pnpm test` runs that on every local `pnpm check`, not just
// on a pull request.
//
// One gap remained after that, and `--print-command` below closes it: the spec
// drives this file with fixture text, so it pinned the DECISION but never the
// INVOCATION. A wrong package, a narrowed `--edges` or the wrong cwd would have
// left every fixture case green while the guard measured the wrong graph — the
// same class of bug as the original, one layer out.
//
// Usage: node scripts/check-core-tauri-free.ts [treeFile | --print-command]
//   no argument     — run `cargo tree` against the workspace and check its output
//   treeFile        — check the tree text in that file instead (what the test does)
//   --print-command — print the `cargo tree` invocation as JSON and exit, so the
//                     test can check it against the real workspace without cargo

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKSPACE = fileURLToPath(new URL('../src-tauri', import.meta.url));
const PACKAGE = 'glimpse-core';

// Match the package NAME, not the line. `tauri`, `tauri-build`, `tauri-utils`,
// `tauri-plugin-…` are all findings; a crate merely containing the word is not,
// and neither is a manifest path — which is the whole bug this replaces.
const TAURI_PACKAGE = /^tauri(-|$)/;

// `cargo tree` draws box characters and ` (*)` de-duplication markers; strip
// both so what is left starts at the package name.
function packageOf(line: string) {
  const stripped = line.replace(/^[\s│├└─|`+-]+/u, '').trim();
  const [name = '', version = ''] = stripped.split(/\s+/u);
  return { name, version, label: version ? `${name} ${version}` : name };
}

// The invocation, in one place so `--print-command` can report exactly what
// would run. `--edges normal,build` is load-bearing in both halves: `normal`
// alone would miss a `tauri-build` in `[build-dependencies]`, and anything
// wider (`dev`) would fail the guard on a dev-dependency the shipped crate
// never links.
const CARGO_TREE = {
  command: 'cargo',
  args: ['tree', '--package', PACKAGE, '--edges', 'normal,build'],
  cwd: WORKSPACE
};

if (process.argv[2] === '--print-command') {
  console.log(JSON.stringify(CARGO_TREE));
  process.exit(0);
}

function treeText() {
  const file = process.argv[2];
  if (file !== undefined) {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      console.error(`check-core-tauri-free: cannot read the tree at ${file}.`);
      process.exit(1);
    }
  }
  const result = spawnSync(CARGO_TREE.command, CARGO_TREE.args, {
    cwd: CARGO_TREE.cwd,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(
      `check-core-tauri-free: \`cargo tree\` failed (status ${result.status}).\n` +
        (result.stderr ?? '')
    );
    process.exit(1);
  }
  return result.stdout ?? '';
}

const tree = treeText();
const packages = tree
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map(packageOf);

// Refuse to pass on nothing. An empty tree means `cargo tree` printed nothing,
// or the wrong file was handed in — either way the claim is unmeasured, and
// reporting a pass on it is exactly the failure mode this script exists for.
if (packages.length === 0 || packages[0]?.name !== PACKAGE) {
  console.error(
    `check-core-tauri-free: no \`cargo tree\` output for ${PACKAGE} — ` +
      `refusing to report a pass on a dependency graph that was never read.`
  );
  process.exit(1);
}

const offenders = [
  ...new Set(
    packages.filter((p) => TAURI_PACKAGE.test(p.name)).map((p) => p.label)
  )
];

if (offenders.length > 0) {
  console.error(
    `check-core-tauri-free: ${PACKAGE} has Tauri in its dependency tree:\n`
  );
  for (const offender of offenders) console.error(`  ${offender}`);
  console.error(
    `\n${PACKAGE} is the engine the CLI runs headlessly; a Tauri dependency ` +
      `here means the command line cannot be built without the desktop ` +
      `toolchain. Move whatever needs it into the \`glimpse\` GUI package.`
  );
  process.exit(1);
}

console.log(
  `check-core-tauri-free: ${packages.length - 1} dependencies of ${PACKAGE} ` +
    `scanned, all Tauri-free.`
);
