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
    const { width, overflow } = inScope(() =>
      useGraphColumnWidth(ref(54), ref(1000))
    );
    expect(width.value).toBe(54);
    expect(overflow.value).toBe(0);
  });

  it('caps the column at its share of the pane', () => {
    // A pathological history asking for 400px in an 800px pane: at the default
    // 40% share the column stops at 320 and reports that it is clipping.
    const { width, overflow } = inScope(() =>
      useGraphColumnWidth(ref(400), ref(800))
    );
    expect(width.value).toBe(320);
    expect(overflow.value).toBe(80);
  });

  it('never caps below the floor, however narrow the pane', () => {
    // 40% of a 100px pane would leave no room for a single lane; the floor wins.
    const { width } = inScope(() => useGraphColumnWidth(ref(200), ref(100)));
    expect(width.value).toBe(54);
  });

  it('applies no cap until the pane has been measured', () => {
    const { width, overflow } = inScope(() =>
      useGraphColumnWidth(ref(200), ref(0))
    );
    expect(width.value).toBe(200);
    expect(overflow.value).toBe(0);
  });

  it('applies the cap as soon as the pane is first measured', async () => {
    // Before the first measurement there is no cap, so the seeded width can be
    // far too wide. Correcting that is not a reclaim and must not be eased out,
    // or a pathological history paints uncapped.
    const pane = ref(0);
    const { width } = inScope(() =>
      useGraphColumnWidth(ref(400), pane, { settleDelay: 400 })
    );
    expect(width.value).toBe(400);
    pane.value = 800;
    await nextTick();
    expect(width.value).toBe(320);
  });

  it('widens the moment a wider stretch comes into view', async () => {
    // Growth is never eased: a lane drawn outside the gutter is a lane lost.
    const needed = ref(36);
    const { width } = inScope(() =>
      useGraphColumnWidth(needed, ref(1000), { settleDelay: 400 })
    );
    needed.value = 126;
    await nextTick();
    expect(width.value).toBe(126);
  });

  it('holds a narrower stretch out, then gives the width back in one step', async () => {
    // Deliberately a step, not a transition. Sliding the column while the rows
    // it indents keep re-rendering read as a glitch rather than as motion.
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

  it('never drops below the width the rows still need', async () => {
    // The one rule the width owes: never narrower than the deepest visible
    // lane, at any moment on the way down.
    const needed = ref(126);
    const { width } = inScope(() =>
      useGraphColumnWidth(needed, ref(1000), { settleDelay: 400 })
    );
    needed.value = 36;
    await nextTick();
    for (let elapsed = 0; elapsed < 400; elapsed += 16) {
      vi.advanceTimersByTime(16);
      expect(width.value).toBeGreaterThanOrEqual(36);
    }
  });

  it('schedules nothing once the column has settled', async () => {
    const needed = ref(126);
    const { width } = inScope(() =>
      useGraphColumnWidth(needed, ref(1000), { settleDelay: 400 })
    );
    expect(vi.getTimerCount()).toBe(0);
    needed.value = 36;
    await nextTick();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(400);
    expect(width.value).toBe(36);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('abandons the wait when the rows need the width again', async () => {
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
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(width.value).toBe(126);
  });

  it('settles once rather than restarting the wait', async () => {
    // Scrolling through a stretch that keeps narrowing must not push the
    // deadline out each time — it arrives after one delay, at the width the
    // rows need by then.
    const needed = ref(126);
    const { width } = inScope(() =>
      useGraphColumnWidth(needed, ref(1000), { settleDelay: 400 })
    );
    needed.value = 54;
    await nextTick();
    vi.advanceTimersByTime(200);
    expect(width.value).toBe(126);
    needed.value = 36;
    await nextTick();
    expect(width.value).toBe(126);
    // One delay from when the narrowing started, not from its latest step.
    vi.advanceTimersByTime(200);
    expect(width.value).toBe(36);
  });

  it('reports how far the graph reaches past its column', () => {
    // The pan range the component's own horizontal scroll has to cover.
    const { overflow } = inScope(() => useGraphColumnWidth(ref(400), ref(800)));
    expect(overflow.value).toBe(80);
  });

  it('reports nothing to pan the moment the rows stop needing the width', async () => {
    // The graph was clipping at the cap, so the gutter could be panned. Once a
    // narrow stretch comes into view there is nothing left to pan — and that has
    // to hold straight away, while the wider stretch is still being held out, or
    // the gutter keeps an offset the user can no longer scroll back.
    const needed = ref(400);
    const { width, overflow } = inScope(() =>
      useGraphColumnWidth(needed, ref(800), { settleDelay: 400 })
    );
    expect(overflow.value).toBe(80);
    needed.value = 100;
    await nextTick();
    expect(overflow.value).toBe(0);
    vi.advanceTimersByTime(200);
    expect(width.value).toBeGreaterThan(100);
    expect(overflow.value).toBe(0);
    vi.advanceTimersByTime(200);
    expect(width.value).toBe(100);
    expect(overflow.value).toBe(0);
  });
});
