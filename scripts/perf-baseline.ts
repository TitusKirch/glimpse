#!/usr/bin/env node
// Measure the four numbers in the README's "Performance baseline" section:
// startup time, resident memory after a repository is open, the installed
// package size, and the Nuxt client bundle.
//
// It is a committed script rather than a one-off measurement because a number
// nobody can reproduce is not a baseline — it is an anecdote. Re-run this after
// a change and the numbers are comparable with the ones in the README, because
// they were taken the same way.
//
// WHAT IT NEEDS BUILT FIRST (it refuses rather than measuring something else):
//
//   pnpm build                     # the Nuxt client bundle, into .output/public
//   pnpm tauri build               # the platform packages
//   pnpm tauri build --no-bundle   # …and the plain binary back, on Linux
//
// That third line is not redundant. On Linux the AppImage step leaves an
// AppImage at `target/release/<name>`, in place of the executable that was
// there — and an AppImage runs against its own vendored GTK/WebKit rather than
// the system's, so measuring it answers a different question than the one the
// `.deb` a user installs asks. The script checks and refuses; see `isAppImage`.
//
// Usage:
//   node scripts/perf-baseline.ts [--runs N] [--repo <dir>] [--json]
//
// Linux needs a display. Without one, run it under Xvfb:
//   xvfb-run -a node scripts/perf-baseline.ts
//
// PLATFORMS. Linux, Windows and macOS each get a code path for the two things
// that cannot be written once: how the process tree's memory is read, and how
// the app is pointed at a throwaway profile so a previous run's restored tabs
// do not become part of the measurement. macOS keeps its real profile — moving
// `HOME` there would also move git's own configuration, and a measurement that
// changes what git does is measuring something else.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatMiB,
  hasSettled,
  isAppImage,
  median,
  parsePsRows,
  parseStartupMs,
  rssTreeKb
} from './perfBaseline.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const manifestPath = join(repoRoot, 'src-tauri', 'Cargo.toml');

// How long one launch may take to reach first paint before it counts as failed.
const STARTUP_TIMEOUT_MS = 60_000;
// Memory sampling: every SAMPLE_MS, until SETTLE_WINDOW consecutive samples
// agree to within SETTLE_TOLERANCE, or SAMPLE_TIMEOUT_MS runs out.
const SAMPLE_MS = 500;
const SETTLE_WINDOW = 4;
const SETTLE_TOLERANCE = 0.02;
const SAMPLE_TIMEOUT_MS = 30_000;

interface Args {
  runs: number;
  repo: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { runs: 3, repo: repoRoot, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--json') args.json = true;
    else if (flag === '--runs') args.runs = Number(argv[(i += 1)]);
    else if (flag === '--repo') args.repo = resolve(String(argv[(i += 1)]));
    else die(`unknown argument: ${flag}`);
  }
  if (!Number.isInteger(args.runs) || args.runs < 1)
    die('--runs wants a count');
  return args;
}

function die(message: string): never {
  console.error(`perf-baseline: ${message}`);
  process.exit(1);
}

interface CargoTarget {
  name: string;
  kind: string[];
}
interface CargoMetadata {
  packages: { targets: CargoTarget[] }[];
  target_directory: string;
}

function cargoMetadata(): CargoMetadata {
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
    die(`cargo metadata failed: ${meta.stderr || meta.error?.message}`);
  }
  return JSON.parse(meta.stdout) as CargoMetadata;
}

/** The first 16 bytes of a file — enough to tell an ELF from an AppImage. */
function readHeader(path: string): Uint8Array {
  const header = new Uint8Array(16);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  return header;
}

/**
 * The release binary. Derived from `cargo metadata` + `tauri.conf.json` rather
 * than hard-coded, the way `tests/e2e/wdio.conf.ts` does it: the workspace
 * layout moves the artefact, and the file is named after either the Tauri
 * `productName` or the crate's `[[bin]]` target depending on the version.
 */
function resolveBinary(meta: CargoMetadata): string {
  const binNames = meta.packages.flatMap((pkg) =>
    pkg.targets.filter((t) => t.kind.includes('bin')).map((t) => t.name)
  );
  const { productName } = JSON.parse(
    readFileSync(join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8')
  ) as { productName?: string };
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const names = [...new Set([productName, ...binNames].filter(Boolean))];
  const candidates = names.map((name) =>
    join(meta.target_directory, 'release', `${name}${suffix}`)
  );
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    die(
      `no release binary. Looked for:\n  ${candidates.join('\n  ')}\n` +
        'Build it first: pnpm tauri build'
    );
  }
  if (isAppImage(readHeader(found))) {
    die(
      `${found} is an AppImage, not the plain binary — the AppImage step of ` +
        '`tauri build` replaced it. An AppImage runs against its own vendored ' +
        'GTK/WebKit, so its startup and memory are not the installed app’s. ' +
        'Put the real binary back:\n' +
        `  rm ${found} && pnpm tauri build --no-bundle`
    );
  }
  return found;
}

/** Total bytes of a file, or of a directory tree. */
function sizeOf(path: string, skip: (name: string) => boolean = () => false) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(path)) {
    if (skip(entry)) continue;
    total += sizeOf(join(path, entry), skip);
  }
  return total;
}

/** The platform packages a `tauri build` produced, biggest concern first. */
function packageArtifacts(meta: CargoMetadata) {
  const bundleDir = join(meta.target_directory, 'release', 'bundle');
  const wanted: Record<string, { dir: string; ext: string }[]> = {
    linux: [
      { dir: 'deb', ext: '.deb' },
      { dir: 'rpm', ext: '.rpm' },
      { dir: 'appimage', ext: '.AppImage' }
    ],
    win32: [
      { dir: 'nsis', ext: '-setup.exe' },
      { dir: 'msi', ext: '.msi' }
    ],
    darwin: [
      { dir: 'macos', ext: '.app' },
      { dir: 'dmg', ext: '.dmg' }
    ]
  };
  const found: { name: string; bytes: number }[] = [];
  for (const { dir, ext } of wanted[process.platform] ?? []) {
    const full = join(bundleDir, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full)) {
      if (!entry.endsWith(ext)) continue;
      found.push({ name: entry, bytes: sizeOf(join(full, entry)) });
    }
  }
  return found;
}

/**
 * A throwaway profile directory, so the measured launch never restores the
 * previous run's tabs. Returns the environment overrides for this platform —
 * empty on macOS, where the only lever is `HOME` and moving it would take git's
 * configuration with it.
 */
function isolatedProfile(dir: string): Record<string, string> {
  if (process.platform === 'linux') {
    return {
      XDG_DATA_HOME: join(dir, 'data'),
      XDG_CONFIG_HOME: join(dir, 'config'),
      XDG_CACHE_HOME: join(dir, 'cache')
    };
  }
  if (process.platform === 'win32') {
    return { APPDATA: join(dir, 'roaming'), LOCALAPPDATA: join(dir, 'local') };
  }
  return {};
}

/** Resident memory of `pid` and its descendants, in bytes. */
function sampleRssBytes(pid: number): number {
  const probe =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { ' +
              '"$($_.ProcessId) $($_.ParentProcessId) ' +
              '$([int]($_.WorkingSetSize/1024))" }'
          ],
          { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
        )
      : // Linux and macOS both speak this `ps`; the columns are pid, parent pid
        // and resident size in kibibytes.
        spawnSync('ps', ['-eo', 'pid=,ppid=,rss='], {
          encoding: 'utf8',
          maxBuffer: 32 * 1024 * 1024
        });
  if (probe.status !== 0) return 0;
  return rssTreeKb(parsePsRows(probe.stdout), pid) * 1024;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  } else {
    // Spawned detached, so the child leads its own process group and the
    // WebKit helper processes go down with it.
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Launch {
  startupMs: number;
  rssBytes: number;
}

/** One launch: time to first paint, then memory once it stops moving. */
async function measureLaunch(binary: string, repo: string): Promise<Launch> {
  const profile = mkdtempSync(join(tmpdir(), 'glimpse-perf-'));
  const child = spawn(binary, [repo], {
    cwd: repo,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // glimpse updates in place, and a build off `dev` always trails the
      // newest release — so left alone it downloads that release over itself
      // while being measured. The memory number would include the download and
      // the next run would measure a binary nobody here built.
      GLIMPSE_ALLOW_UPDATER: '0',
      ...isolatedProfile(profile)
    }
  });

  try {
    const startupMs = await new Promise<number>((resolveMs, rejectMs) => {
      const timer = setTimeout(
        () => rejectMs(new Error('never reached first paint')),
        STARTUP_TIMEOUT_MS
      );
      let buffered = '';
      const onChunk = (chunk: Buffer) => {
        buffered += chunk.toString();
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          const ms = parseStartupMs(line);
          if (ms !== null) {
            clearTimeout(timer);
            resolveMs(ms);
            return;
          }
        }
      };
      child.stdout?.on('data', onChunk);
      child.stderr?.on('data', onChunk);
      child.on('exit', (code) => {
        clearTimeout(timer);
        rejectMs(new Error(`exited with ${code} before first paint`));
      });
    });

    // First paint is not "the repository is open" — the log, status and diff
    // are still arriving. Sample until the number stops moving.
    const samples: number[] = [];
    const deadline = Date.now() + SAMPLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(SAMPLE_MS);
      samples.push(sampleRssBytes(child.pid!));
      if (
        hasSettled(samples, {
          window: SETTLE_WINDOW,
          tolerance: SETTLE_TOLERANCE
        })
      )
        break;
    }
    const rssBytes = samples.at(-1) ?? 0;
    if (rssBytes === 0) die('the app was gone before its memory could be read');
    return { startupMs, rssBytes };
  } finally {
    killTree(child);
    rmSync(profile, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (
    process.platform === 'linux' &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY
  ) {
    die(
      'no display. The app has to actually open a window to be measured — ' +
        'run it under Xvfb: xvfb-run -a node scripts/perf-baseline.ts'
    );
  }

  const clientDir = join(repoRoot, '.output', 'public');
  if (!existsSync(clientDir)) {
    die(`no client bundle at ${clientDir}. Build it first: pnpm build`);
  }
  // Source maps are shipped for readable release stack traces but are not the
  // bundle the app parses, so the growth number excludes them.
  const bundleBytes = sizeOf(clientDir, (name) => name.endsWith('.map'));

  const meta = cargoMetadata();
  const binary = resolveBinary(meta);
  const packages = packageArtifacts(meta);
  if (packages.length === 0) {
    die(
      'no platform package under target/release/bundle. Run: pnpm tauri build'
    );
  }

  const launches: Launch[] = [];
  for (let run = 1; run <= args.runs; run += 1) {
    if (!args.json) console.error(`  launch ${run}/${args.runs}…`);
    launches.push(await measureLaunch(binary, args.repo));
  }

  const result = {
    platform: `${process.platform}-${process.arch}`,
    repo: args.repo,
    runs: args.runs,
    startupMsMedian: median(launches.map((l) => l.startupMs)),
    rssBytesMedian: median(launches.map((l) => l.rssBytes)),
    clientBundleBytes: bundleBytes,
    packages
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`\nglimpse performance baseline — ${result.platform}`);
  console.log(`repository:      ${result.repo}`);
  console.log(`runs:            ${result.runs} (median reported)`);
  console.log(`startup:         ${result.startupMsMedian} ms`);
  console.log(`RSS with a repo: ${formatMiB(result.rssBytesMedian)}`);
  console.log(`client bundle:   ${formatMiB(result.clientBundleBytes)}`);
  for (const pkg of result.packages) {
    console.log(`package:         ${pkg.name} — ${formatMiB(pkg.bytes)}`);
  }
}

await main();
