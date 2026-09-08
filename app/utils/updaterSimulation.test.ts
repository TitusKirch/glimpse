import { describe, expect, it } from 'vitest';
import { SIMULATED_VERSION, simulatedUpdater } from './updaterSimulation';
import {
  SIM_UPDATE_AVAILABLE,
  SIM_UPDATE_CHECK_FAILED,
  SIM_UPDATE_DOWNLOAD_FAILED
} from './simulations';

// No waiting in tests: the ramp's pace is what makes the toast watchable in the
// app, and it is injected for exactly this reason.
const noWait = () => Promise.resolve();

/** A `isOn` reader over a fixed set of switched-on ids. */
function on(...ids: string[]) {
  return (id: string) => ids.includes(id);
}

describe('simulatedUpdater', () => {
  it('is not built when no updater switch is on', () => {
    expect(simulatedUpdater(on(), noWait)).toBeNull();
    expect(simulatedUpdater(on('gitFailure'), noWait)).toBeNull();
  });

  it('offers a version no real release can reach', async () => {
    const updater = simulatedUpdater(on(SIM_UPDATE_AVAILABLE), noWait)!;
    await expect(updater.check('stable', false)).resolves.toBe(
      SIMULATED_VERSION
    );
    expect(SIMULATED_VERSION).toBe('99.0.0-simulated');
  });

  it('fails the check when that state is the one being simulated', async () => {
    const updater = simulatedUpdater(on(SIM_UPDATE_CHECK_FAILED), noWait)!;
    await expect(updater.check('stable', false)).rejects.toThrow(/simulated/i);
  });

  it('reports a download from nothing to complete', async () => {
    const updater = simulatedUpdater(on(SIM_UPDATE_AVAILABLE), noWait)!;
    const seen: (number | null)[] = [];
    await updater.install('stable', false, (p) => seen.push(p));
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(100);
    for (let i = 1; i < seen.length; i++)
      expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
  });

  it('fails the download part-way, never at a complete one', async () => {
    const updater = simulatedUpdater(on(SIM_UPDATE_DOWNLOAD_FAILED), noWait)!;
    const seen: (number | null)[] = [];
    await expect(
      updater.install('stable', false, (p) => seen.push(p))
    ).rejects.toThrow(/simulated/i);
    expect(seen.at(-1)).toBeLessThan(100);
  });

  it('still offers an update when it is the download that is set to fail', async () => {
    // Reaching a failed download means getting past the check first.
    const updater = simulatedUpdater(on(SIM_UPDATE_DOWNLOAD_FAILED), noWait)!;
    await expect(updater.check('stable', false)).resolves.toBe(
      SIMULATED_VERSION
    );
  });

  it('fails the check even when a download failure is also switched on', async () => {
    const updater = simulatedUpdater(
      on(SIM_UPDATE_CHECK_FAILED, SIM_UPDATE_DOWNLOAD_FAILED),
      noWait
    )!;
    await expect(updater.check('stable', false)).rejects.toThrow(/simulated/i);
  });

  it('does not restart', async () => {
    // The whole point of the simulated backend: there is no route from here to a
    // real restart, because there is no IPC in it to reach one with.
    const updater = simulatedUpdater(on(SIM_UPDATE_AVAILABLE), noWait)!;
    await expect(updater.restart()).resolves.toBeUndefined();
  });
});
