// Branches: switching, creating, renaming, deleting, and merging in either
// direction.
//
// `checkout` is the load-bearing one — it owns the dirty-working-tree prompt,
// and the other actions that move HEAD reuse it rather than repeating the
// guard, which is why `mergeCurrentInto` can only merge once checkout has
// actually landed on the target.
import { useRepoStore } from '~/stores/repo';

export const branchActions = {
  async checkout(branch: string): Promise<void> {
    const s = useRepoStore();
    if (branch === s.currentBranch) return;
    await s.native(async () => {
      // Guard a dirty working tree: offer to stash before switching, so the
      // switch doesn't fail (or silently carry changes across).
      let stashFirst = false;
      if (s.status.length) {
        const ok = await useConfirm().confirm({
          titleKey: 'confirm.dirtySwitch.title',
          descriptionKey: 'confirm.dirtySwitch.description',
          confirmKey: 'confirm.dirtySwitch.confirm'
        });
        if (!ok) return;
        stashFirst = true;
      }
      await s.mutate({
        run: async () => {
          if (stashFirst)
            await gitClient.stashSave({ path: s.repoPath, message: '' });
          await gitClient.checkoutBranch({ path: s.repoPath, branch });
        }
      });
    });
  },

  async createBranch(name: string): Promise<void> {
    const s = useRepoStore();
    const trimmed = name.trim();
    if (!trimmed) return;
    await s.mutate({
      run: () => gitClient.createBranch({ path: s.repoPath, name: trimmed })
    });
  },

  async deleteBranch(name: string): Promise<void> {
    const s = useRepoStore();
    await s.native(async () =>
      // The confirm dialog stays open with a busy button until the delete
      // settles (action form of useConfirm).
      useConfirm().confirm({
        titleKey: 'confirm.deleteBranch.title',
        descriptionKey: 'confirm.deleteBranch.description',
        confirmKey: 'branch.delete',
        params: { name },
        destructive: true,
        action: () =>
          s.mutate({
            run: () => gitClient.deleteBranch({ path: s.repoPath, name })
          })
      })
    );
  },

  // Create a branch via a name prompt (replaces the inline sidebar input).
  async createBranchPrompt(): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const name = await usePrompt().prompt({
        titleKey: 'sidebar.newBranch',
        labelKey: 'form.branch.label',
        descriptionKey: 'form.branch.description',
        placeholderKey: 'form.branch.placeholder',
        submitKey: 'form.create',
        schema: branchNameSchema
      });
      if (name) await s.createBranch(name);
    });
  },

  // Rename a branch via a prompt prefilled with its current name.
  async renameBranchPrompt(oldName: string): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const name = await usePrompt().prompt({
        titleKey: 'sidebar.renameBranch',
        labelKey: 'form.branch.label',
        placeholderKey: 'form.branch.placeholder',
        submitKey: 'form.rename',
        initial: oldName,
        schema: branchNameSchema
      });
      if (name) await s.renameBranch({ oldName, newName: name });
    });
  },

  // Checkout a remote branch: if no local branch exists yet, confirm creating
  // a tracking branch; otherwise just switch.
  async checkoutRemote(remoteBranch: string): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const i = remoteBranch.indexOf('/');
      const name = i >= 0 ? remoteBranch.slice(i + 1) : remoteBranch;
      if (s.branches.some((b) => b.name === name)) {
        await s.checkout(name);
        return;
      }
      const ok = await useConfirm().confirm({
        titleKey: 'confirm.checkoutRemote.title',
        descriptionKey: 'confirm.checkoutRemote.description',
        confirmKey: 'confirm.checkoutRemote.confirm',
        params: { name }
      });
      if (ok) await s.checkout(name);
    });
  },

  async renameBranch({
    oldName,
    newName
  }: {
    oldName: string;
    newName: string;
  }): Promise<void> {
    const s = useRepoStore();
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    await s.mutate({
      run: () =>
        gitClient.renameBranch({
          path: s.repoPath,
          oldName,
          newName: trimmed
        })
    });
  },

  // Merge a branch into the current one; conflicts surface in the status.
  async merge(branch: string): Promise<void> {
    const s = useRepoStore();
    if (branch === s.currentBranch) return;
    await s.mutate({
      run: () => gitClient.merge({ path: s.repoPath, branch })
    });
  },

  // Merge the CURRENT branch into `branch` (the reverse direction). Git can't
  // merge into a branch that isn't checked out, so this switches to `branch`
  // first — reusing checkout()'s dirty-tree guard — then merges the former
  // current into it. You end up on `branch`, matching the GitKraken
  // "merge A into B" semantics.
  async mergeCurrentInto(branch: string): Promise<void> {
    const s = useRepoStore();
    if (branch === s.currentBranch) return;
    await s.native(async () => {
      const source = s.currentBranch;
      await s.checkout(branch);
      // checkout() aborts silently if the user declines the dirty-tree prompt;
      // only merge once we're actually on the target.
      if (s.currentBranch !== branch) return;
      await s.merge(source);
    });
  }
};
