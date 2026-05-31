// Repo store. Talks to the Rust/Tauri git backend when running in the desktop
// shell; falls back to mock data in the browser so the UI stays developable.
//
// Multi-repo: each open repository is one RepoState (its identity + its whole
// view — branches, commits, status, diff, selection). The store keeps them
// keyed by id with an activeId; projection getters expose the active repo, so
// switching tabs swaps the entire graph + diff. Transient UI bits
// (commitMessage, busy, lastError) stay at the top level.

// The IPC payload shapes are the single source of truth in src-tauri/src/git.rs;
// app/types/bindings.ts is generated from them (ts-rs). Re-exported here so the
// rest of the app keeps importing these names from the store.
import { promiseTimeout } from '@vueuse/core';
import type {
  Branch,
  Commit,
  CommitFile,
  DiffData,
  RepoInfo,
  StatusEntry
} from '~/types/bindings';

// Keep loading spinners visible for at least this long so fast actions don't
// flicker.
const MIN_SPINNER_MS = 300;

export type { Branch, Commit, CommitFile, DiffData, RepoInfo, StatusEntry };

// Frontend-only types (no backend counterpart).
export type GitFlavor = 'windows' | 'wsl' | 'linux' | 'macos';
export type DiffMode = 'split' | 'unified';

// Everything one open repository shows. The tab strip renders id/name/flavor;
// the panels read the rest of the active repo via projection getters.
export interface RepoState {
  id: string;
  name: string;
  path: string;
  flavor: GitFlavor;
  distro?: string;
  branches: Branch[];
  remoteBranches: string[];
  currentBranch: string;
  remotes: string[];
  tags: string[];
  commits: Commit[];
  status: StatusEntry[];
  selectedHash: string | null;
  selectedFile: string | null;
  selectedFileStaged: boolean;
  commitFiles: CommitFile[];
  diff: DiffData | null;
}

// Demo repository shown in the browser (no Tauri shell).
function demoRepo(): RepoState {
  return {
    id: 'r1',
    name: 'glimpse',
    path: '\\\\wsl$\\Ubuntu-22.04\\home\\titus\\glimpse',
    flavor: 'wsl',
    distro: 'Ubuntu-22.04',
    branches: [
      { name: 'main', ahead: 0, behind: 0 },
      { name: 'dev', ahead: 2, behind: 0 },
      { name: 'feat/wsl', ahead: 1, behind: 3 }
    ],
    remoteBranches: ['origin/main', 'origin/dev'],
    currentBranch: 'main',
    remotes: ['origin'],
    tags: ['v0.0.0'],
    commits: mock.commits,
    status: mock.status,
    selectedHash: null,
    selectedFile: 'app/stores/repo.ts',
    selectedFileStaged: false,
    commitFiles: [],
    diff: mock.diff
  };
}

export const useRepoStore = defineStore('repo', {
  state: () => ({
    repos: { r1: demoRepo() } as Record<string, RepoState>,
    order: ['r1'] as string[],
    activeId: 'r1',
    commitMessage: '',
    lastRefresh: 'just now',
    lastError: null as string | null,
    busy: false,
    // Which remote sync (if any) is in flight — drives the button spinner.
    syncing: null as 'fetch' | 'pull' | 'push' | null,
    refreshing: false
  }),
  getters: {
    // The active repository and the tab strip over all open ones.
    active: (s): RepoState => s.repos[s.activeId]!,
    tabs: (s): RepoState[] => s.order.map((id) => s.repos[id]!),
    activeTabId: (s): string => s.activeId,

    // Projections of the active repo — keep the panel-facing API flat.
    repoPath(): string {
      return this.active?.path ?? '.';
    },
    branches(): Branch[] {
      return this.active.branches;
    },
    remoteBranches(): string[] {
      return this.active.remoteBranches;
    },
    currentBranch(): string {
      return this.active.currentBranch;
    },
    remotes(): string[] {
      return this.active.remotes;
    },
    tags(): string[] {
      return this.active.tags;
    },
    commits(): Commit[] {
      return this.active.commits;
    },
    status(): StatusEntry[] {
      return this.active.status;
    },
    selectedHash(): string | null {
      return this.active.selectedHash;
    },
    selectedFile(): string | null {
      return this.active.selectedFile;
    },
    selectedFileStaged(): boolean {
      return this.active.selectedFileStaged;
    },
    commitFiles(): CommitFile[] {
      return this.active.commitFiles;
    },
    diff(): DiffData | null {
      return this.active.diff;
    },
    selectedCommit(): Commit | null {
      const r = this.active;
      return r.commits.find((c) => c.hash === r.selectedHash) ?? null;
    },
    stagedFiles(): StatusEntry[] {
      return this.active.status.filter((f) => f.staged);
    },
    unstagedFiles(): StatusEntry[] {
      return this.active.status.filter((f) => f.unstaged || f.untracked);
    }
  },
  actions: {
    selectTab(id: string) {
      if (this.repos[id]) this.activeId = id;
    },

    async selectCommit(hash: string) {
      const r = this.active;
      r.selectedHash = hash;
      r.commitFiles = await gitClient.commitFiles(r.path, hash);
      const first = r.commitFiles[0];
      if (first) {
        await this.selectCommitFile(first.path);
      } else {
        r.selectedFile = null;
        r.diff = null;
      }
    },

    async selectCommitFile(file: string) {
      const r = this.active;
      if (!r.selectedHash) return;
      r.selectedFile = file;
      r.diff = await gitClient.commitFileDiff(r.path, r.selectedHash, file);
    },

    async selectFile(file: string, staged: boolean) {
      const r = this.active;
      r.selectedFile = file;
      r.selectedFileStaged = staged;
      r.selectedHash = null;
      r.commitFiles = [];
      r.diff = await gitClient.fileDiff(r.path, file, staged);
    },

    async stage(file: string) {
      if (!isTauri()) return;
      await gitClient.stage(this.repoPath, file);
      await this.loadStatus();
      if (this.active.selectedFile === file) await this.selectFile(file, true);
    },

    async unstage(file: string) {
      if (!isTauri()) return;
      await gitClient.unstage(this.repoPath, file);
      await this.loadStatus();
      if (this.active.selectedFile === file) await this.selectFile(file, false);
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
        if (this.active.selectedFile === file) this.active.diff = null;
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
      this.syncing = command;
      try {
        await Promise.all([
          this.guarded(async () => {
            await gitClient[command](this.repoPath);
            await this.loadFromBackend();
          }),
          promiseTimeout(MIN_SPINNER_MS)
        ]);
      } finally {
        this.syncing = null;
      }
    },

    // Runs an action with a busy flag and surfaces failures via lastError.
    async guarded(fn: () => Promise<void>) {
      this.busy = true;
      this.lastError = null;
      try {
        await fn();
      } catch (err) {
        const raw = typeof err === 'string' ? err : String(err);
        this.lastError = cleanGitError(raw);
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
      this.active.status = await gitClient.status(this.repoPath);
    },

    async loadLog() {
      if (!isTauri()) return;
      const commits = await gitClient.log(this.repoPath);
      if (commits.length) this.active.commits = commits;
    },

    async refresh() {
      this.lastRefresh = 'just now';
      this.refreshing = true;
      try {
        await Promise.all([
          this.loadFromBackend(),
          promiseTimeout(MIN_SPINNER_MS)
        ]);
      } finally {
        this.refreshing = false;
      }
    },

    // When running inside Tauri, replace the active repo's mock data with real
    // git output.
    async loadFromBackend() {
      if (!isTauri()) return;
      try {
        const start = await gitClient.defaultRepo();
        const info = await gitClient.info(start);
        const top = info.toplevel || start;

        const r = this.active;
        r.name = top.split(/[\\/]/).pop() || 'repo';
        r.path = top;
        r.flavor = (info.flavor as GitFlavor) ?? 'linux';
        r.distro = info.distro ?? undefined;
        r.branches = info.branches;
        r.remoteBranches = info.remoteBranches;
        r.currentBranch = info.currentBranch;
        r.remotes = info.remotes;
        r.tags = info.tags;

        await Promise.all([this.loadLog(), this.loadStatus()]);

        // Open the first changed file (or the newest commit) in the diff panel.
        const first = this.unstagedFiles[0] ?? this.stagedFiles[0];
        if (first) {
          await this.selectFile(
            first.path,
            !first.unstaged && !first.untracked
          );
        } else if (r.commits[0]) {
          await this.selectCommit(r.commits[0].hash);
        } else {
          r.diff = null;
        }
      } catch (err) {
        console.error('loadFromBackend failed:', err);
      }
    }
  }
});
