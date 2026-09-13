import { describe, expect, it } from 'vitest';
import {
  formatMiB,
  hasSettled,
  isAppImage,
  median,
  parsePsRows,
  parseStartupMs,
  rssTreeKb
} from './perfBaseline';

// The line the Rust side actually writes, as tauri-plugin-log formats it.
const REAL_LOG_LINE =
  '[2026-09-09][15:04:05][glimpse_lib][INFO] startup: main webview ready in 812 ms';

describe('parseStartupMs', () => {
  it('reads the number out of the line the app logs', () => {
    // The marker is a contract between src-tauri/src/lib.rs and this script.
    // If either side moves, this is where it is meant to break.
    expect(parseStartupMs(REAL_LOG_LINE)).toBe(812);
  });

  it('ignores every other log line', () => {
    expect(parseStartupMs('[INFO] updater disabled in this debug build')).toBe(
      null
    );
    expect(parseStartupMs('')).toBe(null);
  });

  it('ignores the marker without a number behind it', () => {
    expect(parseStartupMs('startup: main webview ready in  ms')).toBe(null);
  });
});

describe('median', () => {
  it('takes the middle of an odd run', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middles of an even run', () => {
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('refuses an empty run rather than reporting a zero', () => {
    // A baseline of "0 ms" from no successful launch is worse than no baseline:
    // it looks like a measurement.
    expect(() => median([])).toThrow();
  });
});

describe('parsePsRows', () => {
  it('reads the pid/ppid/rss triples ps prints', () => {
    expect(parsePsRows(' 123     1  4096\n 456   123  2048\n')).toEqual([
      { pid: 123, ppid: 1, rssKb: 4096 },
      { pid: 456, ppid: 123, rssKb: 2048 }
    ]);
  });

  it('skips lines that are not three numbers', () => {
    expect(parsePsRows('123 1\n\n  \nnot a row\n7 1 9')).toEqual([
      { pid: 7, ppid: 1, rssKb: 9 }
    ]);
  });
});

describe('rssTreeKb', () => {
  const rows = [
    { pid: 100, ppid: 1, rssKb: 50 }, // the app
    { pid: 200, ppid: 100, rssKb: 30 }, // its web process
    { pid: 300, ppid: 200, rssKb: 20 }, // a grandchild
    { pid: 400, ppid: 1, rssKb: 999 } // somebody else entirely
  ];

  it('sums the process and every descendant', () => {
    // On Linux the WebKit web and network processes are separate processes;
    // reporting only the app process would understate what the app costs by
    // most of what a webview app costs.
    expect(rssTreeKb(rows, 100)).toBe(100);
  });

  it('leaves unrelated processes out', () => {
    expect(rssTreeKb(rows, 200)).toBe(50);
  });

  it('is zero when the process is already gone', () => {
    expect(rssTreeKb(rows, 999)).toBe(0);
  });
});

describe('hasSettled', () => {
  it('is false until the window is full', () => {
    expect(hasSettled([100, 101], { window: 3, tolerance: 0.02 })).toBe(false);
  });

  it('is true once the last samples stop moving', () => {
    expect(
      hasSettled([50, 100, 101, 102], { window: 3, tolerance: 0.02 })
    ).toBe(true);
  });

  it('is false while memory is still climbing', () => {
    expect(hasSettled([100, 130, 170], { window: 3, tolerance: 0.02 })).toBe(
      false
    );
  });
});

describe('isAppImage', () => {
  // Bytes 0-7 are the ELF magic and class; an AppImage overwrites the two
  // padding bytes at offset 8 with "AI" and a type byte. This is how the
  // measurement notices that `tauri build` left an AppImage where the plain
  // binary used to be — the mistake that made the first draft of this baseline
  // report the vendored-GTK bundle's memory as the app's.
  const elf = [0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00];

  it('recognises a type-2 AppImage', () => {
    expect(isAppImage(new Uint8Array([...elf, 0x41, 0x49, 0x02, 0x00]))).toBe(
      true
    );
  });

  it('leaves a plain ELF alone', () => {
    expect(isAppImage(new Uint8Array([...elf, 0x00, 0x00, 0x00, 0x00]))).toBe(
      false
    );
  });

  it('says no rather than throwing on a short read', () => {
    expect(isAppImage(new Uint8Array([0x7f, 0x45]))).toBe(false);
  });
});

describe('formatMiB', () => {
  it('reports mebibytes to one decimal', () => {
    expect(formatMiB(1024 * 1024)).toBe('1.0 MiB');
    expect(formatMiB(2.43 * 1024 * 1024)).toBe('2.4 MiB');
  });

  it('reports a zero as a zero, not as nothing', () => {
    expect(formatMiB(0)).toBe('0.0 MiB');
  });
});
