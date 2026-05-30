// Repo store. Talks to the Rust/Tauri git backend when running in the desktop
// shell; falls back to mock data in the browser so the UI stays developable.

// The IPC payload shapes are the single source of truth in src-tauri/src/git.rs;
// app/types/bindings.ts is generated from them (ts-rs). Re-exported here so the
// rest of the app keeps importing these names from the store.
import type {
  Commit,
  CommitFile,
  DiffData,
  RepoInfo,
  StatusEntry
} from '~/types/bindings';

export type { Commit, CommitFile, DiffData, RepoInfo, StatusEntry };

// Frontend-only types (no backend counterpart).
export type GitFlavor = 'windows' | 'wsl' | 'linux' | 'macos';
export type DiffMode = 'split' | 'unified';

export interface RepoTab {
  id: string;
  name: string;
  path: string;
  flavor: GitFlavor;
  distro?: string;
}

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
    commits: mock.commits as Commit[],
    status: mock.status as StatusEntry[],
    selectedHash: null as string | null,
    selectedFile: 'app/stores/repo.ts' as string | null,
    selectedFileStaged: false,
    commitFiles: [] as CommitFile[],
    commitMessage: '',
    diff: mock.diff as DiffData | null,
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
      this.commitFiles = await gitClient.commitFiles(this.repoPath, hash);
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
      this.diff = await gitClient.commitFileDiff(
        this.repoPath,
        this.selectedHash,
        file
      );
    },

    async selectFile(file: string, staged: boolean) {
      this.selectedFile = file;
      this.selectedFileStaged = staged;
      this.selectedHash = null;
      this.commitFiles = [];
      this.diff = await gitClient.fileDiff(this.repoPath, file, staged);
    },

    async stage(file: string) {
      if (!isTauri()) return;
      await gitClient.stage(this.repoPath, file);
      await this.loadStatus();
      if (this.selectedFile === file) await this.selectFile(file, true);
    },

    async unstage(file: string) {
      if (!isTauri()) return;
      await gitClient.unstage(this.repoPath, file);
      await this.loadStatus();
      if (this.selectedFile === file) await this.selectFile(file, false);
    },

    async commit() {
      const message = this.commitMessage.trim();
      if (!message || !this.stagedFiles.length || !isTauri()) return;
      await this.guarded(async () => {
        await gitClient.commit(this.repoPath, message);
        this.commitMessage = '';
        await Promise.all([this.loadStatus(), this.loadLog()]);
      });
    },

    async discard(file: string, untracked: boolean) {
      if (!isTauri()) return;
      await this.guarded(async () => {
        await gitClient.discard(this.repoPath, file, untracked);
        await this.loadStatus();
        if (this.selectedFile === file) this.diff = null;
      });
    },

    async checkout(branch: string) {
      if (!isTauri() || branch === this.currentBranch) return;
      await this.guarded(async () => {
        await gitClient.checkoutBranch(this.repoPath, branch);
        await this.loadFromBackend();
      });
    },

    async createBranch(name: string) {
      const trimmed = name.trim();
      if (!trimmed || !isTauri()) return;
      await this.guarded(async () => {
        await gitClient.createBranch(this.repoPath, trimmed);
        await this.loadFromBackend();
      });
    },

    async deleteBranch(name: string) {
      if (!isTauri()) return;
      await this.guarded(async () => {
        await gitClient.deleteBranch(this.repoPath, name);
        await this.loadFromBackend();
      });
    },

    async sync(command: 'fetch' | 'pull' | 'push') {
      if (!isTauri()) return;
      await this.guarded(async () => {
        await gitClient[command](this.repoPath);
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
      this.status = await gitClient.status(this.repoPath);
    },

    async loadLog() {
      if (!isTauri()) return;
      const commits = await gitClient.log(this.repoPath);
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
        const start = await gitClient.defaultRepo();
        const info = await gitClient.info(start);
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
