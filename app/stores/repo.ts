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
  StashEntry,
  StatusEntry
} from '~/types/bindings';

// Keep loading spinners visible for at least this long so fast actions don't
// flicker.
const MIN_SPINNER_MS = 300;

export type {
  Branch,
  Commit,
  CommitFile,
  DiffData,
  RepoInfo,
  StashEntry,
  StatusEntry
};

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
  stashes: StashEntry[];
  commits: Commit[];
  status: StatusEntry[];
  selectedHash: string | null;
  selectedBody: string;
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
    stashes: [],
    commits: mock.commits,
    status: mock.status,
    selectedHash: null,
    selectedBody: '',
    selectedFile: 'app/stores/repo.ts',
    selectedFileStaged: false,
    commitFiles: [],
    diff: mock.diff
  };
}

// A freshly opened repository before its git data is loaded.
function blankRepo(id: string, path: string): RepoState {
  return {
    id,
    name: path.split(/[\\/]/).pop() || 'repo',
    path,
    flavor: 'linux',
    distro: undefined,
    branches: [],
    remoteBranches: [],
    currentBranch: '',
    remotes: [],
    tags: [],
    stashes: [],
    commits: [],
    status: [],
    selectedHash: null,
    selectedBody: '',
    selectedFile: null,
    selectedFileStaged: false,
    commitFiles: [],
    diff: null
  };
}

export const useRepoStore = defineStore('repo', {
  state: () => ({
    repos: { r1: demoRepo() } as Record<string, RepoState>,
    order: ['r1'] as string[],
    activeId: 'r1',
    // Monotonic counter for unique tab ids.
    seq: 1,
    commitMessage: '',
    // Rewrite the previous commit instead of creating a new one.
    amend: false,
    lastRefresh: 'just now',
    lastError: null as string | null,
    busy: false,
    // True while the active repo's git data loads — drives loading skeletons.
    loading: false,
    // Set when a load fails outright — drives the inline error + retry state.
    loadError: null as string | null,
    // Which remote sync (if any) is in flight — drives the button spinner.
    syncing: null as 'fetch' | 'pull' | 'push' | null,
    refreshing: false
  }),
  getters: {
    // The active repository and the tab strip over all open ones. `active` is
    // undefined when every tab is closed (the start screen shows instead), so
    // the projections below all fall back to safe empties.
    active: (s): RepoState | undefined => s.repos[s.activeId],
    tabs: (s): RepoState[] => s.order.map((id) => s.repos[id]!),
    activeTabId: (s): string => s.activeId,
    hasRepos: (s): boolean => s.order.length > 0,

    // Projections of the active repo — keep the panel-facing API flat.
    repoPath(): string {
      return this.active?.path ?? '.';
    },
    branches(): Branch[] {
      return this.active?.branches ?? [];
    },
    remoteBranches(): string[] {
      return this.active?.remoteBranches ?? [];
    },
    currentBranch(): string {
      return this.active?.currentBranch ?? '';
    },
    remotes(): string[] {
      return this.active?.remotes ?? [];
    },
    tags(): string[] {
      return this.active?.tags ?? [];
    },
    stashes(): StashEntry[] {
      return this.active?.stashes ?? [];
    },
    commits(): Commit[] {
      return this.active?.commits ?? [];
    },
    status(): StatusEntry[] {
      return this.active?.status ?? [];
    },
    selectedHash(): string | null {
      return this.active?.selectedHash ?? null;
    },
    selectedBody(): string {
      return this.active?.selectedBody ?? '';
    },
    selectedFile(): string | null {
      return this.active?.selectedFile ?? null;
    },
    selectedFileStaged(): boolean {
      return this.active?.selectedFileStaged ?? false;
    },
    commitFiles(): CommitFile[] {
      return this.active?.commitFiles ?? [];
    },
    diff(): DiffData | null {
      return this.active?.diff ?? null;
    },
    selectedCommit(): Commit | null {
      const r = this.active;
      if (!r) return null;
      return r.commits.find((c) => c.hash === r.selectedHash) ?? null;
    },
    stagedFiles(): StatusEntry[] {
      return this.status.filter((f) => f.staged);
    },
    unstagedFiles(): StatusEntry[] {
      return this.status.filter((f) => f.unstaged || f.untracked);
    },
    // How far the current branch is behind its upstream — drives the "new
    // commits" indicator on the pull button after a (manual or auto) fetch.
    behind(): number {
      const b = this.branches.find((x) => x.name === this.currentBranch);
      return b?.behind ?? 0;
    }
  },
  actions: {
    selectTab(id: string) {
      if (!this.repos[id]) return;
      this.activeId = id;
      this.watchActive();
    },

    // Point the backend FS watcher at the active repo (live-refresh source).
    watchActive() {
      if (isTauri() && this.active) void gitClient.watchRepo(this.active.path);
    },

    // Light refresh used by the watcher: reload status + log, keep selection.
    async reloadActive() {
      if (!isTauri()) return;
      await Promise.all([this.loadStatus(), this.loadLog()]);
    },

    async selectCommit(hash: string) {
      const r = this.active;
      r.selectedHash = hash;
      r.selectedBody = await gitClient.commitBody(r.path, hash);
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
      r.selectedBody = '';
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
      // Amend can rewrite the last commit with no newly staged files; a normal
      // commit needs something staged.
      if (!message || !isTauri()) return;
      if (!this.amend && !this.stagedFiles.length) return;
      const amend = this.amend;
      await this.guarded(async () => {
        await gitClient.commit(this.repoPath, message, amend);
        this.commitMessage = '';
        this.amend = false;
        await Promise.all([this.loadStatus(), this.loadLog()]);
      });
    },

    // Toggle amend mode. Turning it on prefills the editor with the previous
    // commit's message; turning it off clears it again.
    async setAmend(on: boolean) {
      this.amend = on;
      if (on) {
        if (!this.commitMessage.trim()) {
          this.commitMessage = await gitClient.headMessage(this.repoPath);
        }
      } else {
        this.commitMessage = '';
      }
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

    async renameBranch(oldName: string, newName: string) {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName || !isTauri()) return;
      await this.guarded(async () => {
        await gitClient.renameBranch(this.repoPath, oldName, trimmed);
        await this.loadFromBackend();
      });
    },

    // Check out a commit directly (detached HEAD) to inspect or branch off it.
    async checkoutCommit(hash: string) {
      if (!isTauri()) return;
      await this.guarded(async () => {
        await gitClient.checkoutCommit(this.repoPath, hash);
        await this.loadFromBackend();
      });
    },

    async createTag(name: string, hash = '') {
      const trimmed = name.trim();
      if (!trimmed || !isTauri()) return;
      await this.guarded(async () => {
        await gitClient.createTag(this.repoPath, trimmed, hash);
        await this.loadFromBackend();
      });
    },

    async deleteTag(name: string) {
      if (!isTauri()) return;
      await this.guarded(async () => {
        await gitClient.deleteTag(this.repoPath, name);
        await this.loadFromBackend();
      });
    },

    async stashSave(message = '') {
      if (!isTauri()) return;
      await this.guarded(async () => {
        await gitClient.stashSave(this.repoPath, message);
        await this.loadFromBackend();
      });
    },

    async stashAction(action: 'pop' | 'apply' | 'drop', reference: string) {
      if (!isTauri()) return;
      await this.guarded(async () => {
        if (action === 'pop')
          await gitClient.stashPop(this.repoPath, reference);
        else if (action === 'apply')
          await gitClient.stashApply(this.repoPath, reference);
        else await gitClient.stashDrop(this.repoPath, reference);
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

    // Push with options: publish a new branch (set upstream) and/or force with
    // lease. Shares the push spinner/guard with the plain sync('push').
    async push(setUpstream: boolean, force: boolean) {
      if (!isTauri()) return;
      this.syncing = 'push';
      try {
        await Promise.all([
          this.guarded(async () => {
            await gitClient.push(this.repoPath, setUpstream, force);
            await this.loadFromBackend();
          }),
          promiseTimeout(MIN_SPINNER_MS)
        ]);
      } finally {
        this.syncing = null;
      }
    },

    // Open the active repo's folder in an external app.
    async openIn(app: 'files' | 'terminal' | 'editor') {
      if (!isTauri() || !this.active) return;
      const path = this.active.path;
      await this.guarded(async () => {
        await gitClient.openIn(path, app);
      });
    },

    // Close a repo tab. Activates a neighbour; leaves activeId pointing at a
    // closed id only when nothing remains (the start screen then shows).
    closeRepo(id: string) {
      if (!this.repos[id]) return;
      const idx = this.order.indexOf(id);
      delete this.repos[id];
      this.order = this.order.filter((x) => x !== id);
      if (this.activeId === id) {
        const next = this.order[idx] ?? this.order[idx - 1] ?? '';
        this.activeId = next;
        if (next) this.watchActive();
      }
    },

    // Persist a new tab order after a drag-and-drop reorder.
    reorderTabs(order: string[]) {
      this.order = order;
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
        // Reload the active repo by its own path — not the process CWD, which
        // would overwrite another opened repo's tab with glimpse itself.
        await Promise.all([
          this.loadFromBackend(this.active.path),
          promiseTimeout(MIN_SPINNER_MS)
        ]);
      } finally {
        this.refreshing = false;
      }
    },

    // Open a folder as an additional repository tab and activate it. Re-opening
    // an already-open repo just focuses its tab.
    async openRepo(path: string) {
      if (!isTauri()) return;
      await this.guarded(async () => {
        const top = (await gitClient.info(path)).toplevel || path;
        const existing = this.order
          .map((id) => this.repos[id]!)
          .find((r) => r.path === top);
        if (existing) {
          this.activeId = existing.id;
          return;
        }
        this.seq += 1;
        const id = `r${this.seq}`;
        this.repos[id] = blankRepo(id, top);
        this.order.push(id);
        this.activeId = id;
        await this.loadFromBackend(top);
      });
    },

    // Retry the active repo's load after a failure (inline error → retry).
    async retryLoad() {
      await this.loadFromBackend(this.active?.path);
    },

    // Load real git output into the active repo. Without a path it resolves the
    // process CWD (initial open); with one it (re)loads that repo's tab.
    async loadFromBackend(path?: string) {
      if (!isTauri() || !this.active) return;
      this.loading = true;
      this.loadError = null;
      try {
        const start = path ?? (await gitClient.defaultRepo());
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
        r.stashes = info.stashes;

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

        useRecentStore().push(top, r.name);
        this.watchActive();
      } catch (err) {
        const raw = typeof err === 'string' ? err : String(err);
        this.loadError = cleanGitError(raw);
        console.error('loadFromBackend failed:', err);
      } finally {
        this.loading = false;
      }
    }
  }
});
