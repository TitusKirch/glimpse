// Repo store. Talks to the Rust/Tauri git backend when running in the desktop
// shell; falls back to mock data in the browser so the UI stays developable.

export type GitFlavor = 'windows' | 'wsl' | 'linux' | 'macos';

export interface RepoTab {
  id: string;
  name: string;
  path: string;
  flavor: GitFlavor;
  distro?: string;
}

export interface Commit {
  hash: string;
  subject: string;
  author: string;
  date: string;
  refs: string[];
  parents: string[];
  lane: number;
}

export interface DiffData {
  fileName: string;
  oldContent: string;
  newContent: string;
  hunks: string[];
}

export interface StatusEntry {
  path: string;
  x: string;
  y: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface CommitFile {
  path: string;
  status: string;
}

export type DiffMode = 'split' | 'unified';

export interface RepoInfo {
  toplevel: string;
  currentBranch: string;
  branches: string[];
  remotes: string[];
  tags: string[];
  flavor: string;
  distro: string | null;
}

const MOCK_COMMITS: Commit[] = [
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
];

const MOCK_STATUS: StatusEntry[] = [
  {
    path: 'app/stores/repo.ts',
    x: ' ',
    y: 'M',
    staged: false,
    unstaged: true,
    untracked: false
  },
  {
    path: 'src-tauri/src/git.rs',
    x: 'M',
    y: ' ',
    staged: true,
    unstaged: false,
    untracked: false
  },
  {
    path: 'docs/NOTES.md',
    x: '?',
    y: '?',
    staged: false,
    unstaged: false,
    untracked: true
  }
];

const MOCK_DIFF: DiffData = {
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
  ]
};

export const useRepoStore = defineStore('repo', {
  state: () => ({
    tabs: [
      {
        id: 'r1',
        name: 'glimpse',
        path: '\\\\wsl$\\Ubuntu-22.04\\home\\titus\\glimpse',
        flavor: 'wsl',
        distro: 'Ubuntu-22.04'
      }
    ] as RepoTab[],
    activeTabId: 'r1',
    branches: ['main', 'dev', 'feat/wsl'] as string[],
    currentBranch: 'main',
    remotes: ['origin'] as string[],
    tags: ['v0.0.0'] as string[],
    commits: MOCK_COMMITS,
    status: MOCK_STATUS as StatusEntry[],
    selectedHash: null as string | null,
    selectedFile: 'app/stores/repo.ts' as string | null,
    selectedFileStaged: false,
    commitFiles: [] as CommitFile[],
    commitMessage: '',
    diff: MOCK_DIFF as DiffData | null,
    lastRefresh: 'just now',
    lastError: null as string | null,
    busy: false
  }),
  getters: {
    activeTab: (s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null,
    repoPath(): string {
      return this.activeTab?.path ?? '.';
    },
    selectedCommit: (s) =>
      s.commits.find((c) => c.hash === s.selectedHash) ?? null,
    stagedFiles: (s) => s.status.filter((f) => f.staged),
    unstagedFiles: (s) => s.status.filter((f) => f.unstaged || f.untracked)
  },
  actions: {
    selectTab(id: string) {
      this.activeTabId = id;
    },

    async selectCommit(hash: string) {
      this.selectedHash = hash;
      this.commitFiles = await gitInvoke<CommitFile[]>(
        'commit_files',
        { path: this.repoPath, hash },
        []
      );
      const first = this.commitFiles[0];
      if (first) {
        await this.selectCommitFile(first.path);
      } else {
        this.selectedFile = null;
        this.diff = null;
      }
    },

    async selectCommitFile(file: string) {
      if (!this.selectedHash) return;
      this.selectedFile = file;
      this.diff = await gitInvoke<DiffData | null>(
        'commit_file_diff',
        { path: this.repoPath, hash: this.selectedHash, file },
        MOCK_DIFF
      );
    },

    async selectFile(file: string, staged: boolean) {
      this.selectedFile = file;
      this.selectedFileStaged = staged;
      this.selectedHash = null;
      this.commitFiles = [];
      this.diff = await gitInvoke<DiffData | null>(
        'file_diff',
        { path: this.repoPath, file, staged },
        MOCK_DIFF
      );
    },

    async stage(file: string) {
      if (!isTauri()) return;
      await gitInvoke<null>('stage', { path: this.repoPath, file }, null);
      await this.loadStatus();
      if (this.selectedFile === file) await this.selectFile(file, true);
    },

    async unstage(file: string) {
      if (!isTauri()) return;
      await gitInvoke<null>('unstage', { path: this.repoPath, file }, null);
      await this.loadStatus();
      if (this.selectedFile === file) await this.selectFile(file, false);
    },

    async commit() {
      const message = this.commitMessage.trim();
      if (!message || !this.stagedFiles.length || !isTauri()) return;
      await this.guarded(async () => {
        await gitInvoke<string>('commit', { path: this.repoPath, message }, '');
        this.commitMessage = '';
        await Promise.all([this.loadStatus(), this.loadLog()]);
      });
    },

    async discard(file: string, untracked: boolean) {
      if (!isTauri()) return;
      await this.guarded(async () => {
        await gitInvoke<null>(
          'discard',
          { path: this.repoPath, file, untracked },
          null
        );
        await this.loadStatus();
        if (this.selectedFile === file) this.diff = null;
      });
    },

    async checkout(branch: string) {
      if (!isTauri() || branch === this.currentBranch) return;
      await this.guarded(async () => {
        await gitInvoke<null>(
          'checkout_branch',
          { path: this.repoPath, branch },
          null
        );
        await this.loadFromBackend();
      });
    },

    async createBranch(name: string) {
      const trimmed = name.trim();
      if (!trimmed || !isTauri()) return;
      await this.guarded(async () => {
        await gitInvoke<null>(
          'create_branch',
          { path: this.repoPath, name: trimmed },
          null
        );
        await this.loadFromBackend();
      });
    },

    async deleteBranch(name: string) {
      if (!isTauri()) return;
      await this.guarded(async () => {
        await gitInvoke<null>(
          'delete_branch',
          { path: this.repoPath, name },
          null
        );
        await this.loadFromBackend();
      });
    },

    async sync(command: 'fetch' | 'pull' | 'push') {
      if (!isTauri()) return;
      await this.guarded(async () => {
        await gitInvoke<string>(command, { path: this.repoPath }, '');
        await this.loadFromBackend();
      });
    },

    // Runs an action with a busy flag and surfaces failures via lastError.
    async guarded(fn: () => Promise<void>) {
      this.busy = true;
      this.lastError = null;
      try {
        await fn();
      } catch (err) {
        const raw = typeof err === 'string' ? err : String(err);
        // Trim git noise: indented file lists and the trailing "Aborting".
        this.lastError =
          raw
            .split('\n')
            .filter((l) => !l.startsWith('\t') && l.trim() !== 'Aborting')
            .join('\n')
            .trim() || raw.trim();
        console.error('git action failed:', err);
      } finally {
        this.busy = false;
      }
    },

    clearError() {
      this.lastError = null;
    },

    async loadStatus() {
      if (!isTauri()) return;
      this.status = await gitInvoke<StatusEntry[]>(
        'git_status',
        { path: this.repoPath },
        []
      );
    },

    async loadLog() {
      if (!isTauri()) return;
      const commits = await gitInvoke<Commit[]>('git_log', {
        path: this.repoPath,
        limit: 100
      });
      if (commits.length) this.commits = commits;
    },

    refresh() {
      this.lastRefresh = 'just now';
      void this.loadFromBackend();
    },

    // When running inside Tauri, replace the mock data with real git output.
    async loadFromBackend() {
      if (!isTauri()) return;
      try {
        const start = await gitInvoke<string>('default_repo', {}, '.');
        const info = await gitInvoke<RepoInfo>('repo_info', { path: start });
        const top = info.toplevel || start;

        this.branches = info.branches;
        this.currentBranch = info.currentBranch;
        this.remotes = info.remotes;
        this.tags = info.tags;
        this.tabs = [
          {
            id: 'r1',
            name: top.split(/[\\/]/).pop() || 'repo',
            path: top,
            flavor: (info.flavor as GitFlavor) ?? 'linux',
            distro: info.distro ?? undefined
          }
        ];
        this.activeTabId = 'r1';

        await Promise.all([this.loadLog(), this.loadStatus()]);

        // Open the first changed file (or the newest commit) in the diff panel.
        const first = this.unstagedFiles[0] ?? this.stagedFiles[0];
        if (first) {
          await this.selectFile(
            first.path,
            !first.unstaged && !first.untracked
          );
        } else if (this.commits[0]) {
          await this.selectCommit(this.commits[0].hash);
        } else {
          this.diff = null;
        }
      } catch (err) {
        console.error('loadFromBackend failed:', err);
      }
    }
  }
});
