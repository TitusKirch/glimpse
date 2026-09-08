import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = { error: vi.fn() };
vi.mock('vue-sonner', () => ({ toast }));

const g = globalThis as Record<string, unknown>;
g.useI18n = () => ({ t: (key: string) => key });

const { useGitErrorToast } = await import('./useGitErrorToast');

beforeEach(() => {
  toast.error.mockClear();
  vi.useRealTimers();
});

describe('useGitErrorToast', () => {
  it('collapses a burst of identical failures into one counted toast', () => {
    const show = useGitErrorToast();
    show('fatal: not a git repository');
    show('fatal: not a git repository');
    show('fatal: not a git repository');
    // One id throughout — sonner reuses the slot rather than stacking three.
    const ids = toast.error.mock.calls.map((c) => c[1].id);
    expect(new Set(ids).size).toBe(1);
    expect(toast.error.mock.calls[0]![0]).toBe('error.title');
    expect(toast.error.mock.calls[2]![0]).toBe('error.title (×3)');
    // The message itself never turns into a count — it stays readable.
    expect(toast.error.mock.calls[2]![1].description).toBe(
      'fatal: not a git repository'
    );
  });

  it('gives a genuinely different failure its own toast', () => {
    const show = useGitErrorToast();
    show('fatal: not a git repository');
    show('error: could not lock config file');
    const [first, second] = toast.error.mock.calls;
    expect(first![1].id).not.toBe(second![1].id);
    // The second message is new, so it opens uncounted rather than inheriting
    // the first one's tally.
    expect(second![0]).toBe('error.title');
  });

  it('starts a fresh toast once the previous one has timed out', () => {
    vi.useFakeTimers();
    const show = useGitErrorToast();
    show('fatal: not a git repository');
    vi.advanceTimersByTime(6000);
    show('fatal: not a git repository');
    expect(toast.error.mock.calls.at(-1)![0]).toBe('error.title');
  });
});
