// The named things beside branches: tags, stashes and remotes.
//
// They share a shape rather than a subject — each is a small list the sidebar
// renders, each mutation is a one-call `mutate` that reloads the repo, and the
// destructive ones (delete a tag, drop a stash, remove a remote) confirm first.
// Keeping them together is what keeps that shape visible; splitting them into
// three files of forty lines each would only hide it.
import { useRepoStore } from '~/stores/repo';

export const refActions = {
  // Tag a commit — opens the tag dialog (name + optional message / signing).
  tagAt(hash: string): void {
    useTagCreate().show(hash);
  },

  // Create a tag on HEAD — opens the tag dialog.
  createTagPrompt(): void {
    useTagCreate().show('');
  },

  async createTag({
    name,
    hash = '',
    message = '',
    sign = false
  }: {
    name: string;
    hash?: string;
    message?: string;
    sign?: boolean;
  }): Promise<void> {
    const s = useRepoStore();
    const trimmed = name.trim();
    if (!trimmed) return;
    await s.mutate({
      run: () =>
        gitClient.createTag({
          path: s.repoPath,
          name: trimmed,
          hash,
          message: message.trim(),
          sign
        })
    });
  },

  async deleteTag(name: string): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const ok = await useConfirm().confirm({
        titleKey: 'confirm.deleteTag.title',
        descriptionKey: 'confirm.deleteTag.description',
        confirmKey: 'branch.delete',
        params: { name },
        destructive: true
      });
      if (!ok) return;
      await s.mutate({
        run: () => gitClient.deleteTag({ path: s.repoPath, name })
      });
    });
  },

  async pushTags(): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () => gitClient.pushTags(s.repoPath),
      refresh: 'none'
    });
  },

  async stashSave(
    opts: {
      message?: string;
      includeUntracked?: boolean;
      paths?: string[];
    } = {}
  ): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () =>
        gitClient.stashSave({
          path: s.repoPath,
          message: opts.message ?? '',
          includeUntracked: opts.includeUntracked ?? false,
          paths: opts.paths ?? []
        })
    });
  },

  async stashAction({
    action,
    reference
  }: {
    action: 'pop' | 'apply' | 'drop';
    reference: string;
  }): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      if (action === 'drop') {
        const ok = await useConfirm().confirm({
          titleKey: 'confirm.dropStash.title',
          descriptionKey: 'confirm.dropStash.description',
          confirmKey: 'sidebar.stashDrop',
          destructive: true
        });
        if (!ok) return;
      }
      await s.mutate({
        run: async () => {
          if (action === 'pop')
            await gitClient.stashPop({ path: s.repoPath, reference });
          else if (action === 'apply')
            await gitClient.stashApply({ path: s.repoPath, reference });
          else await gitClient.stashDrop({ path: s.repoPath, reference });
        }
      });
    });
  },

  async addRemote({ name, url }: { name: string; url: string }): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () => gitClient.addRemote({ path: s.repoPath, name, url })
    });
  },

  async removeRemote(name: string): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const ok = await useConfirm().confirm({
        titleKey: 'confirm.removeRemote.title',
        descriptionKey: 'confirm.removeRemote.description',
        confirmKey: 'branch.delete',
        params: { name },
        destructive: true
      });
      if (!ok) return;
      await s.mutate({
        run: () => gitClient.removeRemote({ path: s.repoPath, name })
      });
    });
  },

  async renameRemote(oldName: string): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const name = await usePrompt().prompt({
        titleKey: 'sidebar.renameRemote',
        labelKey: 'form.remoteName.label',
        placeholderKey: 'form.remoteName.placeholder',
        submitKey: 'form.rename',
        initial: oldName,
        schema: remoteNameSchema
      });
      if (!name || name === oldName) return;
      await s.mutate({
        run: () =>
          gitClient.renameRemote({
            path: s.repoPath,
            oldName,
            newName: name
          })
      });
    });
  }
};
