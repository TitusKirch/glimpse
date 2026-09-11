// The measuring parts of `pnpm perf:baseline`, kept apart from the process
// driving so they can be tested without a built binary and a display.
//
// Everything here is pure: a log line in, a number out. The runner
// (`scripts/perf-baseline.ts`) owns the spawning, the sampling loop and the
// platform commands; this file owns what those observations *mean*.

/// The marker `src-tauri/src/lib.rs` logs once per launch, at the main window's
/// first completed page load. BOTH SIDES OF THIS STRING ARE A CONTRACT — the
/// Rust constant is `STARTUP_LOG_PREFIX`.
const STARTUP_RE = /startup: main webview ready in (\d+) ms/;

/** Milliseconds from process start to first paint, or null for any other line. */
export function parseStartupMs(line: string): number | null {
  const m = STARTUP_RE.exec(line);
  return m?.[1] ? Number(m[1]) : null;
}

/**
 * The middle value of a run of measurements.
 *
 * Median rather than mean: a launch that happened to collide with a filesystem
 * flush or a scheduler hiccup is a real outlier, and one of them is enough to
 * move an average by more than the change a baseline is meant to detect.
 */
export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error('median: nothing was measured');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One row of `ps -eo pid=,ppid=,rss=`. */
export interface ProcRow {
  pid: number;
  ppid: number;
  rssKb: number;
}

/** Parse `ps` output; anything that is not three integers is skipped. */
export function parsePsRows(stdout: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const [pid, ppid, rssKb] = parts.map(Number);
    if (
      !Number.isInteger(pid) ||
      !Number.isInteger(ppid) ||
      !Number.isInteger(rssKb)
    )
      continue;
    rows.push({ pid: pid!, ppid: ppid!, rssKb: rssKb! });
  }
  return rows;
}

/**
 * Resident memory of `rootPid` and every descendant, in kibibytes.
 *
 * A webview app is not one process. On Linux WebKitGTK runs the page in a
 * separate web process (and a network process beside it); on Windows WebView2
 * does the same with its own browser/renderer processes. Reporting only the
 * process we spawned would leave out most of what the app actually costs, which
 * is precisely the number the README's "small RAM footprint" claim is about.
 */
export function rssTreeKb(rows: ProcRow[], rootPid: number): number {
  const children = new Map<number, ProcRow[]>();
  for (const row of rows) {
    const siblings = children.get(row.ppid) ?? [];
    siblings.push(row);
    children.set(row.ppid, siblings);
  }
  const root = rows.find((r) => r.pid === rootPid);
  if (!root) return 0;

  let total = 0;
  const queue = [root];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const row = queue.pop()!;
    if (seen.has(row.pid)) continue;
    seen.add(row.pid);
    total += row.rssKb;
    queue.push(...(children.get(row.pid) ?? []));
  }
  return total;
}

/**
 * Whether the last `window` samples agree to within `tolerance`.
 *
 * The app keeps allocating for a while after first paint — it is still reading
 * the repository — so sampling once at a fixed delay measures whatever moment
 * that delay happened to land on. Waiting for the number to stop moving
 * measures the steady state instead, which is the thing worth writing down.
 */
export function hasSettled(
  samples: number[],
  { window, tolerance }: { window: number; tolerance: number }
): boolean {
  if (samples.length < window) return false;
  const recent = samples.slice(-window);
  const max = Math.max(...recent);
  const min = Math.min(...recent);
  if (max === 0) return true;
  return (max - min) / max <= tolerance;
}

/**
 * Whether these leading bytes are an AppImage rather than a plain executable.
 *
 * This is not a curiosity. On Linux `tauri build` leaves an AppImage sitting at
 * `target/release/<name>`, where the plain binary was — and an AppImage is a
 * different program to measure: it mounts a squashfs and runs against its own
 * vendored GTK/WebKit stack instead of the system one, so both its startup and
 * its memory belong to a different thing than the `.deb` a user installs.
 * Measuring it by accident produces numbers that look perfectly plausible,
 * which is exactly why the script refuses instead of trusting the path.
 *
 * Type-2 AppImages carry the magic `AI\x02` at offset 8 of the ELF header.
 */
export function isAppImage(header: Uint8Array): boolean {
  return (
    header.length >= 11 &&
    header[8] === 0x41 &&
    header[9] === 0x49 &&
    header[10] === 0x02
  );
}

/** Bytes as mebibytes, one decimal — the unit every number here lands in. */
export function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
