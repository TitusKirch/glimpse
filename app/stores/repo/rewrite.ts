// History rewriting and history navigation: rebase, bisect, cherry-pick,
// revert, reset, undo, and patch import/export.
//
// Two shapes hold this file together. `runRebaseStep` and `runBisectStep` both
// reload *in a finally* — these commands fail by design (a conflict throws),
// and the banner the user then needs is drawn from the state that failure left
// behind, so the reload must happen on the error path too. Everything else here
// is an ordinary mutate with the confirm dialogs that destructive history
// rewriting earns.
import { toast } from 'vue-sonner';
import type { Commit, RebaseStep } from '~/types/bindings';
import { useRepoStore } from '~/stores/repo';
import { mainlineSchema } from '~/stores/repo/state';

export const rewriteActions = {
  // Rebase the current branch onto `onto`. A conflict pauses the rebase; the
  // banner then offers continue / skip / abort.
  async rebaseOnto(onto: string): Promise<void> {
    const s = useRepoStore();
    if (onto === s.currentBranch) return;
    await s.runRebaseStep(() => gitClient.rebase({ path: s.repoPath, onto }));
  },

  async rebaseContinue(): Promise<void> {
    const s = useRepoStore();
    await s.runRebaseStep(() => gitClient.rebaseContinue(s.repoPath));
  },

  async rebaseSkip(): Promise<void> {
    const s = useRepoStore();
    await s.runRebaseStep(() => gitClient.rebaseSkip(s.repoPath));
  },

  async rebaseAbort(): Promise<void> {
    const s = useRepoStore();
    await s.runRebaseStep(() => gitClient.rebaseAbort(s.repoPath));
  },

  // Run an interactive rebase from a built plan (reword/squash/fixup/drop/
  // reorder). Like the other steps, a conflict pauses into the same banner.
  async interactiveRebase({
    base,
    steps
  }: {
    base: string;
    steps: RebaseStep[];
  }): Promise<void> {
    const s = useRepoStore();
    await s.runRebaseStep(() =>
      gitClient.interactiveRebase({ path: s.repoPath, base, steps })
    );
  },

  // Commits an interactive rebase from `start` would replay (oldest first) —
  // read-only, used by the plan dialog to populate its rows.
  async rebaseCommits(start: string): Promise<Commit[]> {
    const s = useRepoStore();
    return gitClient.rebaseCommits({ path: s.repoPath, start });
  },

  // Run a rebase step, then reload even on failure: a conflict throws but the
  // banner + status still need the fresh rebase-in-progress flag and conflicts.
  async runRebaseStep(fn: () => Promise<unknown>): Promise<void> {
    const s = useRepoStore();
    await s.native(async () =>
      s.guarded(async () => {
        try {
          await fn();
        } finally {
          await s.loadFromBackend(s.active?.path);
        }
      })
    );
  },

  // Start a bisect between a known-bad and known-good ref. Git's output (the
  // next commit to test, or the identified first-bad commit) is toasted.
  async bisectStart({
    bad,
    good
  }: {
    bad: string;
    good: string;
  }): Promise<void> {
    const s = useRepoStore();
    await s.runBisectStep(() =>
      gitClient.bisectStart({ path: s.repoPath, bad, good })
    );
  },

  async bisectMark(verdict: 'good' | 'bad' | 'skip'): Promise<void> {
    const s = useRepoStore();
    await s.runBisectStep(() =>
      gitClient.bisectMark({ path: s.repoPath, verdict })
    );
  },

  async bisectReset(): Promise<void> {
    const s = useRepoStore();
    await s.mutate({ run: () => gitClient.bisectReset(s.repoPath) });
  },

  async runBisectStep(fn: () => Promise<string | undefined>): Promise<void> {
    const s = useRepoStore();
    await s.native(async () =>
      s.guarded(async () => {
        try {
          const out = await fn();
          const summary = (out ?? '').split('\n').slice(0, 2).join('\n').trim();
          if (summary) toast(summary);
        } finally {
          await s.loadFromBackend(s.active?.path);
        }
      })
    );
  },

  // Check out a commit directly (detached HEAD) to inspect or branch off it.
  async checkoutCommit(hash: string): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () => gitClient.checkoutCommit({ path: s.repoPath, hash })
    });
  },

  // Create a branch at a commit and switch to it (prompts for the name).
  async branchAt(hash: string): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const name = await usePrompt().prompt({
        titleKey: 'commit.branchHere',
        labelKey: 'form.branch.label',
        descriptionKey: 'form.branch.description',
        placeholderKey: 'form.branch.placeholder',
        submitKey: 'form.create',
        schema: branchNameSchema
      });
      if (!name) return;
      await s.mutate({
        run: () => gitClient.createBranchAt({ path: s.repoPath, name, hash })
      });
    });
  },

  // Invert a single commit. Reverting a merge prompts for the mainline parent
  // (1-based), which git requires (`-m`) there.
  async revert(hash: string): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const commit = s.active?.commits.find((c) => c.hash === hash);
      let mainline: number | undefined;
      if (commit && commit.parents.length > 1) {
        const picked = await usePrompt().prompt({
          titleKey: 'commit.revertMerge.title',
          labelKey: 'commit.revertMerge.label',
          descriptionKey: 'commit.revertMerge.description',
          placeholderKey: 'commit.revertMerge.placeholder',
          submitKey: 'commit.revert',
          initial: '1',
          schema: mainlineSchema(commit.parents.length)
        });
        if (!picked) return;
        mainline = Number(picked);
      }
      await s.mutate({
        run: () =>
          gitClient.revert({ path: s.repoPath, hashes: [hash], mainline })
      });
    });
  },

  async cherryPick(hash: string): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () => gitClient.cherryPick({ path: s.repoPath, hashes: [hash] })
    });
  },

  async cherryPickSelected(): Promise<void> {
    const s = useRepoStore();
    const hashes = s.orderedSelection();
    if (!hashes.length) return;
    await s.mutate({
      run: () => gitClient.cherryPick({ path: s.repoPath, hashes })
    });
    s.multiSel = [];
  },

  async revertSelected(): Promise<void> {
    const s = useRepoStore();
    const hashes = s.orderedSelection();
    if (!hashes.length) return;
    await s.mutate({
      run: () => gitClient.revert({ path: s.repoPath, hashes })
    });
    s.multiSel = [];
  },

  // Move the current branch to a commit. A hard reset discards working-tree
  // changes, so it confirms first.
  async reset({
    hash,
    mode
  }: {
    hash: string;
    mode: 'soft' | 'mixed' | 'hard';
  }): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      if (mode === 'hard') {
        const ok = await useConfirm().confirm({
          titleKey: 'confirm.resetHard.title',
          descriptionKey: 'confirm.resetHard.description',
          confirmKey: 'confirm.resetHard.confirm'
        });
        if (!ok) return;
      }
      await s.mutate({
        run: () => gitClient.reset({ path: s.repoPath, hash, mode })
      });
    });
  },

  // Undo the last HEAD-moving action by resetting hard to HEAD@{1} (the
  // previous reflog position) — recovers from a mistaken reset/rebase/merge/
  // commit. Working-tree changes are discarded, so it confirms first.
  async undoLast(): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const ok = await useConfirm().confirm({
        titleKey: 'reflog.undo.title',
        descriptionKey: 'reflog.undo.description',
        confirmKey: 'reflog.undo.confirm',
        destructive: true
      });
      if (!ok) return;
      await s.mutate({
        run: () =>
          gitClient.reset({
            path: s.repoPath,
            hash: 'HEAD@{1}',
            mode: 'hard'
          })
      });
    });
  },

  // Export a commit to a .patch file (the caller picks `dest` via a dialog).
  async exportPatch({
    hash,
    dest
  }: {
    hash: string;
    dest: string;
  }): Promise<void> {
    const s = useRepoStore();
    await s.native(() =>
      gitClient.exportPatch({ path: s.repoPath, hash, dest })
    );
  },

  // Apply a patch file (`git am`) and reload — a conflict surfaces as an error.
  async applyPatch({ src }: { src: string }): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      await gitClient.applyPatch({ path: s.repoPath, src, mode: 'am' });
      await s.loadFromBackend(s.active?.path);
    });
  }
};
