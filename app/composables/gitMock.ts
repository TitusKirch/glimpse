// Demo fixtures shown in the browser (no Tauri shell) so the UI stays
// developable. They are the git layer's dev fallback: gitClient reads fall back
// to this data and the repo store seeds its demo state from it.

import type { Commit, DiffData, StatusEntry } from '~/types/bindings';

export const gitMock = {
  commits: [
    {
      hash: 'a1b2c3d',
      subject: 'feat(diff): side-by-side diff panel',
      author: 'Titus Kirch',
      date: '2026-05-30',
      refs: ['HEAD -> main'],
      parents: ['b2c3d4e'],
      lane: 0
    },
    {
      hash: 'b2c3d4e',
      subject: 'feat(graph): render commit lanes as SVG',
      author: 'Titus Kirch',
      date: '2026-05-29',
      refs: [],
      parents: ['c3d4e5f'],
      lane: 0
    },
    {
      hash: 'c3d4e5f',
      subject: 'feat(wsl): resolve git per repo flavor',
      author: 'Titus Kirch',
      date: '2026-05-29',
      refs: ['origin/main'],
      parents: ['d4e5f60', 'f6a7b80'],
      lane: 0
    },
    {
      hash: 'f6a7b80',
      subject: 'feat(wsl): detect installed distros',
      author: 'Titus Kirch',
      date: '2026-05-28',
      refs: ['feat/wsl'],
      parents: ['d4e5f60'],
      lane: 1
    },
    {
      hash: 'd4e5f60',
      subject: 'chore: scaffold tauri + nuxt shell',
      author: 'Titus Kirch',
      date: '2026-05-28',
      refs: [],
      parents: ['e5f6071'],
      lane: 0
    },
    {
      hash: 'e5f6071',
      subject: 'chore: adapt scaffold template for glimpse',
      author: 'Titus Kirch',
      date: '2026-05-27',
      refs: ['v0.0.0'],
      parents: [],
      lane: 0
    }
  ] satisfies Commit[],
  status: [
    {
      path: 'app/stores/repo.ts',
      x: ' ',
      y: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      isLfs: false
    },
    {
      path: 'src-tauri/src/git.rs',
      x: 'M',
      y: ' ',
      staged: true,
      unstaged: false,
      untracked: false,
      conflicted: false,
      isLfs: false
    },
    {
      path: 'docs/NOTES.md',
      x: '?',
      y: '?',
      staged: false,
      unstaged: false,
      untracked: true,
      conflicted: false,
      isLfs: false
    }
  ] satisfies StatusEntry[],
  diff: {
    fileName: 'app/stores/repo.ts',
    oldContent: '',
    newContent: '',
    hunks: [
      `@@ -1,4 +1,6 @@
 export const useRepoStore = defineStore('repo', {
-  state: () => ({ commits: [] }),
+  state: () => ({ commits: [], status: [] }),
+  // now talks to the real git backend
 })`
    ],
    isLfs: false
  } satisfies DiffData
};
