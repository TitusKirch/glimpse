// Worktrees, submodules and sparse-checkout — the three features that operate
// beside the active repository's view rather than on it.
//
// Which is exactly what makes them one file: worktrees and submodules refresh
// nothing here (their dialogs refetch their own lists, so `refresh: 'none'`),
// while sparse-checkout is the one that does reload, because changing the
// sparse set changes which files exist in the working tree at all.
import { useRepoStore } from '~/stores/repo';

export const toolActions = {
  async worktreeAdd({
    path,
    ref
  }: {
    path: string;
    ref?: string;
  }): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () =>
        gitClient.worktreeAdd({
          path: s.repoPath,
          wtPath: path,
          reference: ref ?? ''
        }),
      refresh: 'none'
    });
  },

  async worktreeRemove(path: string): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () => gitClient.worktreeRemove({ path: s.repoPath, wtPath: path }),
      refresh: 'none'
    });
  },

  async submoduleUpdate(): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () => gitClient.submoduleUpdate(s.repoPath),
      refresh: 'none'
    });
  },

  async submoduleSync(): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () => gitClient.submoduleSync(s.repoPath),
      refresh: 'none'
    });
  },

  // Sparse-checkout changes which files are in the working tree, so a full
  // reload refreshes the file views to the new sparse set.
  async sparseSet(patterns: string[]): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () => gitClient.sparseSet({ path: s.repoPath, patterns })
    });
  },

  async sparseDisable(): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () => gitClient.sparseDisable(s.repoPath)
    });
  }
};
