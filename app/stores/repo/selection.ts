// What the user is looking at: the selected commit, the selected file, the
// diff they imply, and the graph-row click that moves between them.
//
// Selection and diff are one concern, not two: every selection change ends in a
// diff fetch, and `reDiff` exists so a display option (whitespace, whole-file)
// can re-ask for the current one without knowing which kind of selection it is.
import { markRaw } from 'vue';
import { useRepoStore } from '~/stores/repo';
import { isStashRef } from '~/stores/repo/state';

export const selectionActions = {
  async selectCommit(hash: string): Promise<void> {
    const s = useRepoStore();
    const r = s.active;
    if (!r) return;
    s.multiSel = [];
    r.selectedHash = hash;
    r.selectedBody = await gitClient.commitBody({ path: r.path, hash });
    // A stash lists its files via the stash machinery (a merge commit's
    // name-status from `git show` is unreliable).
    r.commitFiles = markRaw(
      isStashRef(hash)
        ? await gitClient.stashFiles({ path: r.path, reference: hash })
        : await gitClient.commitFiles({ path: r.path, hash })
    );
    const first = r.commitFiles[0];
    if (first) {
      await s.selectCommitFile(first.path);
    } else {
      r.selectedFile = null;
      r.diff = null;
    }
  },

  async selectCommitFile(file: string): Promise<void> {
    const s = useRepoStore();
    const r = s.active;
    if (!r?.selectedHash) return;
    r.selectedFile = file;
    const ws = useLayoutStore().ignoreWhitespace;
    const whole = useSettingsStore().diffMode === 'whole';
    const diff = isStashRef(r.selectedHash)
      ? await gitClient.stashFileDiff({
          path: r.path,
          reference: r.selectedHash,
          file,
          ignoreWhitespace: ws,
          whole
        })
      : await gitClient.commitFileDiff({
          path: r.path,
          hash: r.selectedHash,
          file,
          ignoreWhitespace: ws,
          whole
        });
    // markRaw rejects a null, and "no diff to show" is a real answer here.
    r.diff = diff ? markRaw(diff) : null;
  },

  async selectFile({
    file,
    staged
  }: {
    file: string;
    staged: boolean;
  }): Promise<void> {
    const s = useRepoStore();
    const r = s.active;
    if (!r) return;
    r.selectedFile = file;
    r.selectedFileStaged = staged;
    r.selectedHash = null;
    r.selectedBody = '';
    r.commitFiles = [];
    const ws = useLayoutStore().ignoreWhitespace;
    const whole = useSettingsStore().diffMode === 'whole';
    const diff = await gitClient.fileDiff({
      path: r.path,
      file,
      staged,
      ignoreWhitespace: ws,
      whole
    });
    r.diff = diff ? markRaw(diff) : null;
  },

  // Re-run the diff for the current selection (commit file or working file),
  // e.g. after toggling the whitespace option.
  async reDiff(): Promise<void> {
    const s = useRepoStore();
    const r = s.active;
    if (!r?.selectedFile) return;
    if (r.selectedHash) await s.selectCommitFile(r.selectedFile);
    else
      await s.selectFile({
        file: r.selectedFile,
        staged: r.selectedFileStaged
      });
  },

  // The multi-selected hashes ordered oldest-first (the order cherry-pick and
  // revert want), derived from their position in the loaded log.
  orderedSelection(): string[] {
    const s = useRepoStore();
    const commits = s.active?.commits ?? [];
    const index = (h: string) => commits.findIndex((c) => c.hash === h);
    // commits are newest-first, so a higher index is older → sort descending.
    return [...s.multiSel].sort((a, b) => index(b) - index(a));
  },

  // Graph row click with modifiers: Ctrl/Cmd toggles a commit in the
  // multi-selection, Shift extends a contiguous range from the anchor, a plain
  // click selects a single commit (and shows its diff, clearing the selection).
  rowClick({
    hash,
    additive,
    range
  }: {
    hash: string;
    additive: boolean;
    range: boolean;
  }): void {
    const s = useRepoStore();
    const commits = s.active?.commits ?? [];
    if (range) {
      const anchor = s.multiSel.at(-1) ?? s.active?.selectedHash ?? hash;
      const i = commits.findIndex((c) => c.hash === anchor);
      const j = commits.findIndex((c) => c.hash === hash);
      if (i >= 0 && j >= 0) {
        const [lo, hi] = i <= j ? [i, j] : [j, i];
        s.multiSel = commits.slice(lo, hi + 1).map((c) => c.hash);
        return;
      }
    }
    if (additive) {
      s.multiSel = s.multiSel.includes(hash)
        ? s.multiSel.filter((h) => h !== hash)
        : [...s.multiSel, hash];
      return;
    }
    void s.selectCommit(hash);
  }
};
