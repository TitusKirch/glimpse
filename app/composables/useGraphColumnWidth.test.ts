import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { useGraphColumnWidth } from './useGraphColumnWidth';

const scopes: EffectScope[] = [];

// Every case runs inside its own reactive scope so the composable's pending
// timers are disposed with it rather than leaking into the next test.
function inScope<T>(fn: () => T): T {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(fn)!;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  while (scopes.length) scopes.pop()!.stop();
  vi.useRealTimers();
});

describe('useGraphColumnWidth', () => {
  it('gives the column exactly the width its rows ask for', () => {
    const { width, overflows } = inScope(() =>
      useGraphColumnWidth(ref(54), ref(1000))
    );
    expect(width.value).toBe(54);
    expect(overflows.value).toBe(false);
  });

  it('caps the column at its share of the pane', () => {
    // A pathological history asking for 400px in an 800px pane: at the default
    // 40% share the column stops at 320 and reports that it is clipping.
    const { width, overflows } = inScope(() =>
      useGraphColumnWidth(ref(400), ref(800))
    );
    expect(width.value).toBe(320);
    expect(overflows.value).toBe(true);
  });

  it('never caps below the floor, however narrow the pane', () => {
    // 40% of a 100px pane would leave no room for a single lane; the floor wins.
    const { width } = inScope(() => useGraphColumnWidth(ref(200), ref(100)));
    expect(width.value).toBe(54);
  });

  it('applies no cap until the pane has been measured', () => {
    const { width, overflows } = inScope(() =>
      useGraphColumnWidth(ref(200), ref(0))
    );
    expect(width.value).toBe(200);
    expect(overflows.value).toBe(false);
  });

  it('widens the moment a wider stretch comes into view', async () => {
    const needed = ref(36);
    const { width } = inScope(() =>
      useGraphColumnWidth(needed, ref(1000), { settleDelay: 400 })
    );
    needed.value = 126;
    await nextTick();
    expect(width.value).toBe(126);
  });

  it('reclaims width only once the narrower stretch has held', async () => {
    const needed = ref(126);
    const { width } = inScope(() =>
      useGraphColumnWidth(needed, ref(1000), { settleDelay: 400 })
    );
    needed.value = 36;
    await nextTick();
    expect(width.value).toBe(126);
    vi.advanceTimersByTime(399);
    expect(width.value).toBe(126);
    vi.advanceTimersByTime(1);
    expect(width.value).toBe(36);
  });

  it('keeps the width when a narrow stretch does not hold', async () => {
    const needed = ref(126);
    const { width } = inScope(() =>
      useGraphColumnWidth(needed, ref(1000), { settleDelay: 400 })
    );
    needed.value = 36;
    await nextTick();
    vi.advanceTimersByTime(200);
    needed.value = 126;
    await nextTick();
    expect(width.value).toBe(126);
    vi.advanceTimersByTime(1000);
    expect(width.value).toBe(126);
  });

  it('settles once, on the width the rows need by then', async () => {
    // Scrolling through a stretch that keeps narrowing must not restart the
    // wait each time — it reclaims after one delay, down to the current need.
    const needed = ref(126);
    const { width } = inScope(() =>
      useGraphColumnWidth(needed, ref(1000), { settleDelay: 400 })
    );
    needed.value = 54;
    await nextTick();
    vi.advanceTimersByTime(200);
    needed.value = 36;
    await nextTick();
    vi.advanceTimersByTime(200);
    expect(width.value).toBe(36);
  });
});
