// The working tree: staging (by file, hunk or line), discarding, resolving
// conflicts, and the three ways a commit is made.
//
// Everything here refreshes with `refresh: 'status'` or does its own reload —
// never a full repo reload — because a staging change moves files between two
// lists and repaints one diff; re-reading the whole graph for that is the kind
// of cost the user feels on every click.
import { useRepoStore } from '~/stores/repo';

export const workingTreeActions = {
  // Stage or unstage a single hunk, then refresh status and the diff.
  async applyHunk({
    file,
    hunk,
    reverse
  }: {
    file: string;
    hunk: string;
    reverse: boolean;
  }): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () => gitClient.applyHunk({ path: s.repoPath, file, hunk, reverse }),
      refresh: 'status'
    });
  },

  // Stage or unstage only the selected lines of a hunk (line-level staging).
  async applyLines({
    file,
    hunk,
    lines,
    reverse
  }: {
    file: string;
    hunk: string;
    lines: number[];
    reverse: boolean;
  }): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () =>
        gitClient.applyLines({
          path: s.repoPath,
          file,
          hunk,
          lines,
          reverse
        }),
      refresh: 'status'
    });
  },

  // Discard a single hunk from the working tree (reverse-apply). Destructive,
  // so it confirms first.
  async discardHunk({
    file,
    hunk
  }: {
    file: string;
    hunk: string;
  }): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const ok = await useConfirm().confirm({
        titleKey: 'changes.discardHunk.title',
        descriptionKey: 'changes.discardHunk.description',
        confirmKey: 'changes.discard',
        destructive: true
      });
      if (!ok) return;
      await s.mutate({
        run: () => gitClient.discardHunk({ path: s.repoPath, file, hunk }),
        refresh: 'status'
      });
    });
  },

  async stage(file: string): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      // Capture the target so a tab close/switch during the awaits can't make
      // `s.active` undefined (crash) or land on the wrong tab.
      const r = s.active;
      if (!r) return;
      await gitClient.stage({ path: r.path, file });
      await s.loadStatus(r);
      if (s.active === r && r.selectedFile === file)
        await s.selectFile({ file, staged: true });
    });
  },

  async unstage(file: string): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const r = s.active;
      if (!r) return;
      await gitClient.unstage({ path: r.path, file });
      await s.loadStatus(r);
      if (s.active === r && r.selectedFile === file)
        await s.selectFile({ file, staged: false });
    });
  },

  async commit(): Promise<void> {
    const s = useRepoStore();
    const message = s.commitMessage.trim();
    // Amend can rewrite the last commit with no newly staged files; a normal
    // commit needs something staged.
    if (!message) return;
    if (!s.amend && !s.stagedFiles.length) return;
    const amend = s.amend;
    await s.mutate({
      refresh: 'none',
      run: async () => {
        await gitClient.commit({ path: s.repoPath, message, amend });
        s.commitMessage = '';
        s.amend = false;
        await Promise.all([s.loadStatus(), s.loadLog()]);
      }
    });
  },

  // Commit exactly `files` (one changelist) via the backend `commit_paths`:
  // stages only those paths, leaving the other lists' changes uncommitted.
  async commitList(files: string[]): Promise<void> {
    const s = useRepoStore();
    const message = s.commitMessage.trim();
    if (!message) return;
    if (!s.amend && !files.length) return;
    const amend = s.amend;
    await s.mutate({
      refresh: 'none',
      run: async () => {
        await gitClient.commitPaths({
          path: s.repoPath,
          message,
          files,
          amend
        });
        s.commitMessage = '';
        s.amend = false;
        await Promise.all([s.loadStatus(), s.loadLog()]);
      }
    });
  },

  // Commit a per-file hunk selection (review & commit a changelist partially)
  // via `commit_partial`: stages exactly the chosen files/hunks, leaving every
  // unselected hunk in the working tree. `files` with empty `hunks` commit
  // whole. Mirrors commitList's guards and refresh.
  async commitPartial(
    files: { path: string; hunks: string[] }[]
  ): Promise<void> {
    const s = useRepoStore();
    const message = s.commitMessage.trim();
    if (!message) return;
    if (!s.amend && !files.length) return;
    const amend = s.amend;
    await s.mutate({
      refresh: 'none',
      run: async () => {
        await gitClient.commitPartial({
          path: s.repoPath,
          message,
          files,
          amend
        });
        s.commitMessage = '';
        s.amend = false;
        await Promise.all([s.loadStatus(), s.loadLog()]);
      }
    });
  },

  // Toggle amend mode. Turning it on prefills the editor with the previous
  // commit's message; turning it off clears it again.
  async setAmend(on: boolean): Promise<void> {
    const s = useRepoStore();
    s.amend = on;
    if (on) {
      if (!s.commitMessage.trim()) {
        s.commitMessage = await gitClient.headMessage(s.repoPath);
      }
    } else {
      s.commitMessage = '';
    }
  },

  async discard({
    file,
    untracked
  }: {
    file: string;
    untracked: boolean;
  }): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      refresh: 'none',
      run: async () => {
        const r = s.active;
        if (!r) return;
        await gitClient.discard({ path: r.path, file, untracked });
        await s.loadStatus(r);
        if (s.active === r && r.selectedFile === file) r.diff = null;
      }
    });
  },

  // Discard every working-tree change (confirms first — irreversible).
  async discardAll(): Promise<void> {
    const s = useRepoStore();
    if (!s.status.length) return;
    await s.native(async () => {
      const ok = await useConfirm().confirm({
        titleKey: 'confirm.discardAll.title',
        descriptionKey: 'confirm.discardAll.description',
        confirmKey: 'confirm.discardAll.confirm'
      });
      if (!ok) return;
      await s.mutate({
        refresh: 'none',
        run: async () => {
          await gitClient.discardAll(s.repoPath);
          await s.loadStatus();
          s.active!.diff = null;
          s.active!.selectedFile = null;
        }
      });
    });
  },

  async resolveConflict({
    file,
    side
  }: {
    file: string;
    side: 'ours' | 'theirs' | 'mark';
  }): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () => gitClient.resolveConflict({ path: s.repoPath, file, side }),
      refresh: 'status'
    });
  },

  // Save a resolution built in the merge editor and stage the file.
  async saveResolution({
    file,
    content
  }: {
    file: string;
    content: string;
  }): Promise<void> {
    const s = useRepoStore();
    await s.mutate({
      run: () =>
        gitClient.resolveConflictSave({ path: s.repoPath, file, content }),
      refresh: 'status'
    });
  }
};
