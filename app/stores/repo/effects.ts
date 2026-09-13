// The three primitives every other action in this directory is built on:
// the Native/Browser gate, the busy-flag + error wrapper, and the
// run-then-refresh shape almost every mutating action shares.
//
// They live at the bottom of the store's own dependency order — everything
// calls them, they call nothing but each other and the loaders.
import { useRepoStore } from '~/stores/repo';

export const effectActions = {
  // The single Native/Browser gate for store effects. Runs `fn` only inside
  // the desktop shell; in the browser demo it's a no-op so the mock data
  // stays put. Every action that reaches the git backend — or shows a git
  // dialog that only makes sense against a real repo — goes through here, so
  // the `isTauri()` check lives in one place instead of at each call site.
  async native<T>(fn: () => Promise<T> | T): Promise<T | undefined> {
    if (!isTauri()) return;
    return fn();
  },

  // Runs an action with a busy flag and surfaces failures via lastError.
  async guarded(fn: () => Promise<void>): Promise<void> {
    const s = useRepoStore();
    s.busy = true;
    s.lastError = null;
    try {
      await fn();
    } catch (err) {
      const raw = typeof err === 'string' ? err : String(err);
      s.lastError = cleanGitError(raw);
      console.error('git action failed:', err);
    } finally {
      s.busy = false;
    }
  },

  // The shape almost every mutating action shares: skip outside Tauri, run the
  // git call under `guarded` (busy flag + error surfacing), then refresh.
  // `refresh` picks how the view re-syncs — 'reload' re-reads the whole repo
  // (the default), 'status' refreshes the working-tree status + current diff,
  // 'none' leaves any view update to `run` itself.
  async mutate({
    run,
    refresh = 'reload'
  }: {
    run: () => Promise<unknown>;
    refresh?: 'reload' | 'status' | 'none';
  }): Promise<void> {
    const s = useRepoStore();
    await s.native(() =>
      s.guarded(async () => {
        await run();
        if (refresh === 'reload') await s.loadFromBackend(s.active?.path);
        else if (refresh === 'status') {
          await s.loadStatus();
          await s.reDiff();
        }
      })
    );
  },

  clearError(): void {
    useRepoStore().lastError = null;
  }
};
