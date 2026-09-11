// Talking to the remote: fetch, pull and push.
//
// The whole point of this file is `doSync`'s catch. Git's remote failures are
// mostly not errors at all but questions it has no way to ask — "there is no
// upstream", "these branches have diverged" — and a client that shows them as
// red text has simply passed the buck. So each recognised failure is turned
// into the dialog it deserves (publish the branch, set an upstream, pick a
// reconcile strategy) and retried; only an unrecognised one becomes lastError.
import { promiseTimeout } from '@vueuse/core';
import type { PullStrategy } from '~/stores/layout';
import { useRepoStore } from '~/stores/repo';
import { MIN_SPINNER_MS } from '~/stores/repo/state';

export const syncActions = {
  async sync(command: 'fetch' | 'pull' | 'push'): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      s.syncing = command;
      s.busy = true;
      s.lastError = null;
      try {
        await Promise.all([s.doSync(command), promiseTimeout(MIN_SPINNER_MS)]);
      } finally {
        s.busy = false;
        s.syncing = null;
      }
    });
  },

  // Pull with the given strategy, or the user's configured default when none
  // is passed (the plain pull-button click). The backend always gets an
  // explicit strategy, so git never aborts on "how to reconcile".
  async doPull(strategy?: PullStrategy): Promise<void> {
    const s = useRepoStore();
    await gitClient.pull({
      path: s.repoPath,
      strategy: strategy ?? useSettingsStore().pullStrategy
    });
  },

  // Runs a sync, turning the "no upstream / no tracking" failures into a
  // helpful prompt (publish branch / set upstream) instead of a raw error,
  // and a diverged-branches failure into a strategy chooser. `strategy`
  // overrides the configured default for this one pull.
  async doSync(
    command: 'fetch' | 'pull' | 'push',
    strategy?: PullStrategy
  ): Promise<void> {
    const s = useRepoStore();
    try {
      if (command === 'pull') await s.doPull(strategy);
      else if (command === 'push') await gitClient.push({ path: s.repoPath });
      else await gitClient.fetch(s.repoPath);
      await s.loadFromBackend(s.active?.path);
    } catch (err) {
      const raw = typeof err === 'string' ? err : String(err);
      // A pull that can't fast-forward (e.g. --ff-only on diverged branches)
      // isn't a hard error — let the user pick how to reconcile, then retry.
      if (
        command === 'pull' &&
        /not possible to fast-forward|reconcile divergent|diverging|divergent branches/i.test(
          raw
        )
      ) {
        const choice = await usePullStrategy().choose({
          initial: useSettingsStore().pullStrategy
        });
        if (!choice) return;
        try {
          await s.doPull(choice);
          await s.loadFromBackend(s.active?.path);
        } catch (retryErr) {
          s.lastError = cleanGitError(String(retryErr));
        }
        return;
      }
      if (command === 'push' && /upstream/i.test(raw)) {
        const ok = await useConfirm().confirm({
          titleKey: 'confirm.publishBranch.title',
          descriptionKey: 'confirm.publishBranch.description',
          confirmKey: 'confirm.publishBranch.confirm'
        });
        if (ok) {
          await gitClient.push({
            path: s.repoPath,
            setUpstream: true,
            force: false
          });
          await s.loadFromBackend(s.active?.path);
        }
        return;
      }
      if (command === 'pull' && /no tracking information|upstream/i.test(raw)) {
        const ok = await useConfirm().confirm({
          titleKey: 'confirm.setUpstream.title',
          descriptionKey: 'confirm.setUpstream.description',
          confirmKey: 'confirm.setUpstream.confirm'
        });
        if (ok) {
          await gitClient.setUpstream({
            path: s.repoPath,
            remote: 'origin',
            branch: s.currentBranch
          });
          await s.doPull();
          await s.loadFromBackend(s.active?.path);
        }
        return;
      }
      s.lastError = cleanGitError(raw);
      console.error('sync failed:', err);
    }
  },

  // Pull with an explicit strategy (the pull-button dropdown), as opposed to
  // sync('pull') which uses the configured default. Shares the pull spinner/
  // guard and the same diverged-branches handling via doSync.
  async pull({ strategy }: { strategy: PullStrategy }): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      s.syncing = 'pull';
      s.busy = true;
      s.lastError = null;
      try {
        await Promise.all([
          s.doSync('pull', strategy),
          promiseTimeout(MIN_SPINNER_MS)
        ]);
      } finally {
        s.busy = false;
        s.syncing = null;
      }
    });
  },

  // Push with options: publish a new branch (set upstream) and/or force with
  // lease. Shares the push spinner/guard with the plain sync('push').
  async push({
    setUpstream,
    force
  }: {
    setUpstream: boolean;
    force: boolean;
  }): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      s.syncing = 'push';
      try {
        await Promise.all([
          s.guarded(async () => {
            await gitClient.push({ path: s.repoPath, setUpstream, force });
            await s.loadFromBackend(s.active?.path);
          }),
          promiseTimeout(MIN_SPINNER_MS)
        ]);
      } finally {
        s.syncing = null;
      }
    });
  }
};
