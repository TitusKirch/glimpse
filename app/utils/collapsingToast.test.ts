import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = { error: vi.fn() };
vi.mock('vue-sonner', () => ({ toast }));

const { toastCollapsedError } = await import('./collapsingToast');

beforeEach(() => {
  toast.error.mockClear();
  vi.useRealTimers();
});

describe('toastCollapsedError', () => {
  it('collapses a burst of identical failures into one counted toast', () => {
    toastCollapsedError('Error', 'fatal: simulated git failure');
    toastCollapsedError('Error', 'fatal: simulated git failure');
    toastCollapsedError('Error', 'fatal: simulated git failure');
    // One id throughout — sonner reuses the slot rather than stacking three.
    const ids = toast.error.mock.calls.map((c) => c[1].id);
    expect(new Set(ids).size).toBe(1);
    expect(toast.error.mock.calls[0]![0]).toBe('Error');
    expect(toast.error.mock.calls[2]![0]).toBe('Error (×3)');
    // The message itself never turns into a count — it stays readable.
    expect(toast.error.mock.calls[2]![1].description).toBe(
      'fatal: simulated git failure'
    );
  });

  it('counts the same failure once across the surfaces that report it', () => {
    // Its own message: the tally is module state by design, so a test that
    // reused the burst above would inherit that burst's count.
    toastCollapsedError('Error', 'fatal: detached HEAD');
    // The unhandled-rejection net carries its own title for the same message.
    toastCollapsedError('Something went wrong', 'fatal: detached HEAD');
    const [first, second] = toast.error.mock.calls;
    expect(second![1].id).toBe(first![1].id);
    expect(second![0]).toBe('Something went wrong (×2)');
  });

  it('gives a genuinely different failure its own toast', () => {
    toastCollapsedError('Error', 'fatal: simulated git failure');
    toastCollapsedError('Error', 'error: could not lock config file');
    const [first, second] = toast.error.mock.calls;
    expect(second![1].id).not.toBe(first![1].id);
    // The second message is new, so it opens uncounted rather than inheriting
    // the first one's tally.
    expect(second![0]).toBe('Error');
  });

  it('starts a fresh toast once the previous one has timed out', () => {
    vi.useFakeTimers();
    toastCollapsedError('Error', 'fatal: simulated git failure');
    vi.advanceTimersByTime(6000);
    toastCollapsedError('Error', 'fatal: simulated git failure');
    expect(toast.error.mock.calls.at(-1)![0]).toBe('Error');
  });
});
