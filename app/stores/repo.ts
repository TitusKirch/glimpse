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
import { acceptHMRUpdate } from 'pinia';
import { z } from 'zod';
import { toast } from 'vue-sonner';
import type {
  BlameLine,
  Branch,
  Commit,
  CommitFile,
  DiffData,
  RebaseStep,
  RepoInfo,
  StashEntry,
  StatusEntry
} from '~/types/bindings';
import type { PullStrategy } from '~/stores/layout';

// Keep loading spinners visible for at least this long so fast actions don't
// flicker.
const MIN_SPINNER_MS = 300;

export type {
  BlameLine,
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
export type DiffMode = 'split' | 'unified' | 'whole';

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
  // False until this tab's git data has been fetched. Restored tabs start as
  // unloaded placeholders and lazy-load on first activation.
  loaded: boolean;
  // True while the tab's platform (flavor/distro) is being probed — drives the
  // tab-icon spinner so a WSL tab shows a spinner, never the wrong-distro
  // penguin, until its real distro is known (resolved in the background for
  // placeholders that haven't been activated yet).
  resolving: boolean;
  // True while a rebase is paused (e.g. on a conflict) — drives the rebase
  // banner with continue / skip / abort.
  rebaseInProgress: boolean;
  // True while a bisect session is active — drives the bisect banner.
  bisectInProgress: boolean;
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
    commits: gitMock.commits,
    status: gitMock.status,
    selectedHash: null,
    selectedBody: '',
    selectedFile: 'app/stores/repo.ts',
    selectedFileStaged: false,
    commitFiles: [],
    diff: gitMock.diff,
    loaded: true,
    resolving: false,
    rebaseInProgress: false,
    bisectInProgress: false
  };
}

// A freshly opened repository before its git data is loaded.
function blankRepo({ id, path }: { id: string; path: string }): RepoState {
  return {
    id,
    name: path.split(/[\\/]/).pop() || 'repo',
    path,
    // Guess the flavor from the path so a restored placeholder shows a sensible
    // badge before it loads; corrected from real git output on load.
    flavor: /^[\\/]{2}wsl/i.test(path) ? 'wsl' : 'linux',
    distro: undefined,
    // A WSL placeholder's distro isn't known until probed — spin its icon until
    // then (resolved on activation or in the background) instead of flashing the
    // generic penguin. Non-WSL tabs show no distro icon, so they never spin.
    resolving: /^[\\/]{2}wsl/i.test(path),
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
    diff: null,
    loaded: false,
    rebaseInProgress: false,
    bisectInProgress: false
  };
}

// Serializes repo opening. Concurrent/rapid openRepo calls (double-clicking a
// recent, switching while another open is mid-flight) would otherwise interleave
// on the async `info` resolve and create a duplicate tab. Chaining them makes
// each open see the tabs the previous one created.
let openChain: Promise<unknown> = Promise.resolve();

// Tab ids whose platform metadata is being probed in the background, so two
// loads don't both fetch `info` for the same placeholder.
const resolvingPlatform = new Set<string>();

// A stash is referenced as `stash@{N}`. It needs stash-specific diff commands —
// being a merge commit, `git show` would yield an unusable combined diff.
function isStashRef(ref: string): boolean {
  return ref.startsWith('stash@{');
}

// Validate the 1-based mainline parent entered when reverting a merge commit.
function mainlineSchema(parents: number): z.ZodType<string> {
  return z.string().refine(
    (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= parents;
    },
    { message: 'form.validation.mainline' }
  );
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
    refreshing: false,
    // How many commits to load; raised by "load more history".
    logLimit: 200,
    loadingMore: false,
    // Whether the last log fetch hit the limit (i.e. more history exists). Stored
    // rather than derived so it doesn't flip false mid-load and hide the button.
    hasMore: false,
    // Multi-selected commit hashes in the graph (Ctrl/Shift-click) for bulk
    // cherry-pick / revert. Cleared on a plain click or tab switch.
    multiSel: [] as string[]
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
    rebaseInProgress(): boolean {
      return this.active?.rebaseInProgress ?? false;
    },
    bisectInProgress(): boolean {
      return this.active?.bisectInProgress ?? false;
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
    conflictedFiles(): StatusEntry[] {
      return this.status.filter((f) => f.conflicted);
    },
    // How far the current branch is behind its upstream — drives the "incoming
    // commits" badge on the pull button after a (manual or auto) fetch.
    behind(): number {
      const b = this.branches.find((x) => x.name === this.currentBranch);
      return b?.behind ?? 0;
    },
    // How far the current branch is ahead of its upstream — drives the
    // "unpushed commits" badge on the push button.
    ahead(): number {
      const b = this.branches.find((x) => x.name === this.currentBranch);
      return b?.ahead ?? 0;
    },
    // The last log fetch hit the limit, so more history can be loaded.
    hasMoreHistory(): boolean {
      return this.hasMore;
    }
  },
  actions: {
    async selectTab(id: string) {
      if (!this.repos[id]) return;
      this.activeId = id;
      this.multiSel = [];
      this.watchActive();
      this.syncSession();
      // Lazy-load a restored placeholder on first activation; cached afterwards,
      // so re-selecting an already-loaded tab is instant.
      if (!this.repos[id]!.loaded) {
        await this.loadFromBackend(this.repos[id]!.path);
      }
    },

    // Persist the open repo paths + active path so the tabs reopen next launch.
    syncSession() {
      void this.native(() => {
        const s = useSessionStore();
        s.openPaths = this.order.map((id) => this.repos[id]!.path);
        s.activePath = this.active?.path ?? '';
        s.initialized = true;
      });
    },

    // Reopen the previous session's tabs. First-ever launch (not initialized)
    // opens the process CWD; if the user had closed every tab, show the start
    // screen instead of forcing the CWD back open.
    async restoreSession() {
      return this.native(async () => {
        const s = useSessionStore();
        if (!s.initialized) {
          await this.loadFromBackend();
          this.syncSession();
          return;
        }
        const paths = [...s.openPaths];
        const activePath = s.activePath;
        // Rebuild instantly as lightweight placeholders (no backend call) so the
        // tab strip paints immediately — no start-screen flash and no waiting for
        // every repo to load. Only the active repo loads now; the rest lazy-load
        // on first activation. Validation is deferred too: an invalid repo shows
        // an inline error on its tab instead of silently vanishing here.
        this.repos = {};
        this.order = [];
        this.activeId = '';
        for (const p of paths) {
          this.seq += 1;
          const id = `r${this.seq}`;
          this.repos[id] = blankRepo({ id, path: p });
          this.order.push(id);
        }
        const target =
          this.tabs.find((t) => t.path === activePath) ?? this.tabs[0];
        if (target) await this.selectTab(target.id);
        this.syncSession();
        // First repo is loaded — settle the other tabs' platform icons in the
        // background so they don't spin until the user clicks each one.
        void this.resolveTabPlatforms();
      });
    },

    // Initialise a new repository in `parent` (optional initial branch) and open
    // it in a tab. Returns the new path; errors propagate so the dialog can toast.
    async initRepo({ parent, branch }: { parent: string; branch?: string }) {
      return this.native(async () => {
        const path = await gitClient.initRepo({ path: parent, branch });
        if (path) await this.openRepo(path);
        return path;
      });
    },

    // Clone `url` into `parent` and open the new repo in a tab. Returns the new
    // path; errors propagate so the dialog can toast.
    async cloneRepo({ url, parent }: { url: string; parent: string }) {
      return this.native(async () => {
        const path = await gitClient.cloneRepo({ path: parent, url });
        if (path) await this.openRepo(path);
        return path;
      });
    },

    // Point the backend FS watcher at the active repo (live-refresh source).
    watchActive() {
      if (isTauri() && this.active) void gitClient.watchRepo(this.active.path);
    },

    // Light refresh used by the watcher: reload status + log, keep selection.
    async reloadActive() {
      return this.native(async () => {
        await Promise.all([this.loadStatus(), this.loadLog()]);
      });
    },

    async selectCommit(hash: string) {
      const r = this.active;
      if (!r) return;
      this.multiSel = [];
      r.selectedHash = hash;
      r.selectedBody = await gitClient.commitBody({ path: r.path, hash });
      // A stash lists its files via the stash machinery (a merge commit's
      // name-status from `git show` is unreliable).
      r.commitFiles = isStashRef(hash)
        ? await gitClient.stashFiles({ path: r.path, reference: hash })
        : await gitClient.commitFiles({ path: r.path, hash });
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
      if (!r?.selectedHash) return;
      r.selectedFile = file;
      const ws = useLayoutStore().ignoreWhitespace;
      const whole = useSettingsStore().diffMode === 'whole';
      r.diff = isStashRef(r.selectedHash)
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
    },

    async selectFile({ file, staged }: { file: string; staged: boolean }) {
      const r = this.active;
      if (!r) return;
      r.selectedFile = file;
      r.selectedFileStaged = staged;
      r.selectedHash = null;
      r.selectedBody = '';
      r.commitFiles = [];
      const ws = useLayoutStore().ignoreWhitespace;
      const whole = useSettingsStore().diffMode === 'whole';
      r.diff = await gitClient.fileDiff({
        path: r.path,
        file,
        staged,
        ignoreWhitespace: ws,
        whole
      });
    },

    // Re-run the diff for the current selection (commit file or working file),
    // e.g. after toggling the whitespace option.
    async reDiff() {
      const r = this.active;
      if (!r?.selectedFile) return;
      if (r.selectedHash) await this.selectCommitFile(r.selectedFile);
      else
        await this.selectFile({
          file: r.selectedFile,
          staged: r.selectedFileStaged
        });
    },

    // Stage or unstage a single hunk, then refresh status and the diff.
    async applyHunk({
      file,
      hunk,
      reverse
    }: {
      file: string;
      hunk: string;
      reverse: boolean;
    }) {
      return this.mutate({
        run: () =>
          gitClient.applyHunk({ path: this.repoPath, file, hunk, reverse }),
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
    }) {
      return this.mutate({
        run: () =>
          gitClient.applyLines({
            path: this.repoPath,
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
    async discardHunk({ file, hunk }: { file: string; hunk: string }) {
      return this.native(async () => {
        const ok = await useConfirm().confirm({
          titleKey: 'changes.discardHunk.title',
          descriptionKey: 'changes.discardHunk.description',
          confirmKey: 'changes.discard',
          destructive: true
        });
        if (!ok) return;
        await this.mutate({
          run: () => gitClient.discardHunk({ path: this.repoPath, file, hunk }),
          refresh: 'status'
        });
      });
    },

    async stage(file: string) {
      return this.native(async () => {
        // Capture the target so a tab close/switch during the awaits can't make
        // `this.active` undefined (crash) or land on the wrong tab.
        const r = this.active;
        if (!r) return;
        await gitClient.stage({ path: r.path, file });
        await this.loadStatus(r);
        if (this.active === r && r.selectedFile === file)
          await this.selectFile({ file, staged: true });
      });
    },

    async unstage(file: string) {
      return this.native(async () => {
        const r = this.active;
        if (!r) return;
        await gitClient.unstage({ path: r.path, file });
        await this.loadStatus(r);
        if (this.active === r && r.selectedFile === file)
          await this.selectFile({ file, staged: false });
      });
    },

    async commit() {
      const message = this.commitMessage.trim();
      // Amend can rewrite the last commit with no newly staged files; a normal
      // commit needs something staged.
      if (!message) return;
      if (!this.amend && !this.stagedFiles.length) return;
      const amend = this.amend;
      return this.mutate({
        refresh: 'none',
        run: async () => {
          await gitClient.commit({ path: this.repoPath, message, amend });
          this.commitMessage = '';
          this.amend = false;
          await Promise.all([this.loadStatus(), this.loadLog()]);
        }
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

    async discard({ file, untracked }: { file: string; untracked: boolean }) {
      return this.mutate({
        refresh: 'none',
        run: async () => {
          const r = this.active;
          if (!r) return;
          await gitClient.discard({ path: r.path, file, untracked });
          await this.loadStatus(r);
          if (this.active === r && r.selectedFile === file) r.diff = null;
        }
      });
    },

    async checkout(branch: string) {
      if (branch === this.currentBranch) return;
      return this.native(async () => {
        // Guard a dirty working tree: offer to stash before switching, so the
        // switch doesn't fail (or silently carry changes across).
        let stashFirst = false;
        if (this.status.length) {
          const ok = await useConfirm().confirm({
            titleKey: 'confirm.dirtySwitch.title',
            descriptionKey: 'confirm.dirtySwitch.description',
            confirmKey: 'confirm.dirtySwitch.confirm'
          });
          if (!ok) return;
          stashFirst = true;
        }
        await this.mutate({
          run: async () => {
            if (stashFirst)
              await gitClient.stashSave({ path: this.repoPath, message: '' });
            await gitClient.checkoutBranch({ path: this.repoPath, branch });
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
    }) {
      return this.mutate({
        run: () =>
          gitClient.resolveConflict({ path: this.repoPath, file, side }),
        refresh: 'status'
      });
    },

    // Save a resolution built in the merge editor and stage the file.
    async saveResolution({ file, content }: { file: string; content: string }) {
      return this.mutate({
        run: () =>
          gitClient.resolveConflictSave({ path: this.repoPath, file, content }),
        refresh: 'status'
      });
    },

    async createBranch(name: string) {
      const trimmed = name.trim();
      if (!trimmed) return;
      return this.mutate({
        run: () =>
          gitClient.createBranch({ path: this.repoPath, name: trimmed })
      });
    },

    async deleteBranch(name: string) {
      return this.native(async () =>
        // The confirm dialog stays open with a busy button until the delete
        // settles (action form of useConfirm).
        useConfirm().confirm({
          titleKey: 'confirm.deleteBranch.title',
          descriptionKey: 'confirm.deleteBranch.description',
          confirmKey: 'branch.delete',
          params: { name },
          destructive: true,
          action: () =>
            this.mutate({
              run: () => gitClient.deleteBranch({ path: this.repoPath, name })
            })
        })
      );
    },

    // Create a branch via a name prompt (replaces the inline sidebar input).
    async createBranchPrompt() {
      return this.native(async () => {
        const name = await usePrompt().prompt({
          titleKey: 'sidebar.newBranch',
          labelKey: 'form.branch.label',
          descriptionKey: 'form.branch.description',
          placeholderKey: 'form.branch.placeholder',
          submitKey: 'form.create',
          schema: branchNameSchema
        });
        if (name) await this.createBranch(name);
      });
    },

    // Rename a branch via a prompt prefilled with its current name.
    async renameBranchPrompt(oldName: string) {
      return this.native(async () => {
        const name = await usePrompt().prompt({
          titleKey: 'sidebar.renameBranch',
          labelKey: 'form.branch.label',
          placeholderKey: 'form.branch.placeholder',
          submitKey: 'form.rename',
          initial: oldName,
          schema: branchNameSchema
        });
        if (name) await this.renameBranch({ oldName, newName: name });
      });
    },

    // Checkout a remote branch: if no local branch exists yet, confirm creating
    // a tracking branch; otherwise just switch.
    async checkoutRemote(remoteBranch: string) {
      return this.native(async () => {
        const i = remoteBranch.indexOf('/');
        const name = i >= 0 ? remoteBranch.slice(i + 1) : remoteBranch;
        if (this.branches.some((b) => b.name === name)) {
          await this.checkout(name);
          return;
        }
        const ok = await useConfirm().confirm({
          titleKey: 'confirm.checkoutRemote.title',
          descriptionKey: 'confirm.checkoutRemote.description',
          confirmKey: 'confirm.checkoutRemote.confirm',
          params: { name }
        });
        if (ok) await this.checkout(name);
      });
    },

    async renameBranch({
      oldName,
      newName
    }: {
      oldName: string;
      newName: string;
    }) {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      return this.mutate({
        run: () =>
          gitClient.renameBranch({
            path: this.repoPath,
            oldName,
            newName: trimmed
          })
      });
    },

    // Merge a branch into the current one; conflicts surface in the status.
    async merge(branch: string) {
      if (branch === this.currentBranch) return;
      return this.mutate({
        run: () => gitClient.merge({ path: this.repoPath, branch })
      });
    },

    // Merge the CURRENT branch into `branch` (the reverse direction). Git can't
    // merge into a branch that isn't checked out, so this switches to `branch`
    // first — reusing checkout()'s dirty-tree guard — then merges the former
    // current into it. You end up on `branch`, matching the GitKraken
    // "merge A into B" semantics.
    async mergeCurrentInto(branch: string) {
      if (branch === this.currentBranch) return;
      return this.native(async () => {
        const source = this.currentBranch;
        await this.checkout(branch);
        // checkout() aborts silently if the user declines the dirty-tree prompt;
        // only merge once we're actually on the target.
        if (this.currentBranch !== branch) return;
        await this.merge(source);
      });
    },

    // Rebase the current branch onto `onto`. A conflict pauses the rebase; the
    // banner then offers continue / skip / abort.
    async rebaseOnto(onto: string) {
      if (onto === this.currentBranch) return;
      return this.runRebaseStep(() =>
        gitClient.rebase({ path: this.repoPath, onto })
      );
    },
    async rebaseContinue() {
      return this.runRebaseStep(() => gitClient.rebaseContinue(this.repoPath));
    },
    async rebaseSkip() {
      return this.runRebaseStep(() => gitClient.rebaseSkip(this.repoPath));
    },
    async rebaseAbort() {
      return this.runRebaseStep(() => gitClient.rebaseAbort(this.repoPath));
    },
    // Run an interactive rebase from a built plan (reword/squash/fixup/drop/
    // reorder). Like the other steps, a conflict pauses into the same banner.
    async interactiveRebase({
      base,
      steps
    }: {
      base: string;
      steps: RebaseStep[];
    }) {
      return this.runRebaseStep(() =>
        gitClient.interactiveRebase({ path: this.repoPath, base, steps })
      );
    },
    // Commits an interactive rebase from `start` would replay (oldest first) —
    // read-only, used by the plan dialog to populate its rows.
    async rebaseCommits(start: string): Promise<Commit[]> {
      return gitClient.rebaseCommits({ path: this.repoPath, start });
    },
    // Run a rebase step, then reload even on failure: a conflict throws but the
    // banner + status still need the fresh rebase-in-progress flag and conflicts.
    async runRebaseStep(fn: () => Promise<unknown>) {
      return this.native(async () =>
        this.guarded(async () => {
          try {
            await fn();
          } finally {
            await this.loadFromBackend(this.active?.path);
          }
        })
      );
    },

    // Start a bisect between a known-bad and known-good ref. Git's output (the
    // next commit to test, or the identified first-bad commit) is toasted.
    async bisectStart({ bad, good }: { bad: string; good: string }) {
      return this.runBisectStep(() =>
        gitClient.bisectStart({ path: this.repoPath, bad, good })
      );
    },
    async bisectMark(verdict: 'good' | 'bad' | 'skip') {
      return this.runBisectStep(() =>
        gitClient.bisectMark({ path: this.repoPath, verdict })
      );
    },
    async bisectReset() {
      return this.mutate({ run: () => gitClient.bisectReset(this.repoPath) });
    },
    async runBisectStep(fn: () => Promise<string | undefined>) {
      return this.native(async () =>
        this.guarded(async () => {
          try {
            const out = await fn();
            const summary = (out ?? '')
              .split('\n')
              .slice(0, 2)
              .join('\n')
              .trim();
            if (summary) toast(summary);
          } finally {
            await this.loadFromBackend(this.active?.path);
          }
        })
      );
    },

    // Worktrees affect the linked-worktree set, not the active repo's view, so
    // these don't reload it; the worktrees dialog refetches its own list.
    async worktreeAdd({ path, ref }: { path: string; ref?: string }) {
      return this.mutate({
        run: () =>
          gitClient.worktreeAdd({
            path: this.repoPath,
            wtPath: path,
            reference: ref ?? ''
          }),
        refresh: 'none'
      });
    },
    async worktreeRemove(path: string) {
      return this.mutate({
        run: () =>
          gitClient.worktreeRemove({ path: this.repoPath, wtPath: path }),
        refresh: 'none'
      });
    },

    // Submodule update/sync touch nested repos, not the active view; the
    // submodules dialog refetches its own list.
    async submoduleUpdate() {
      return this.mutate({
        run: () => gitClient.submoduleUpdate(this.repoPath),
        refresh: 'none'
      });
    },
    async submoduleSync() {
      return this.mutate({
        run: () => gitClient.submoduleSync(this.repoPath),
        refresh: 'none'
      });
    },

    // Sparse-checkout changes which files are in the working tree, so a full
    // reload refreshes the file views to the new sparse set.
    async sparseSet(patterns: string[]) {
      return this.mutate({
        run: () => gitClient.sparseSet({ path: this.repoPath, patterns })
      });
    },
    async sparseDisable() {
      return this.mutate({
        run: () => gitClient.sparseDisable(this.repoPath)
      });
    },

    // Discard every working-tree change (confirms first — irreversible).
    async discardAll() {
      if (!this.status.length) return;
      return this.native(async () => {
        const ok = await useConfirm().confirm({
          titleKey: 'confirm.discardAll.title',
          descriptionKey: 'confirm.discardAll.description',
          confirmKey: 'confirm.discardAll.confirm'
        });
        if (!ok) return;
        await this.mutate({
          refresh: 'none',
          run: async () => {
            await gitClient.discardAll(this.repoPath);
            await this.loadStatus();
            this.active!.diff = null;
            this.active!.selectedFile = null;
          }
        });
      });
    },

    async pushTags() {
      return this.mutate({
        run: () => gitClient.pushTags(this.repoPath),
        refresh: 'none'
      });
    },

    async addRemote({ name, url }: { name: string; url: string }) {
      return this.mutate({
        run: () => gitClient.addRemote({ path: this.repoPath, name, url })
      });
    },

    async removeRemote(name: string) {
      return this.native(async () => {
        const ok = await useConfirm().confirm({
          titleKey: 'confirm.removeRemote.title',
          descriptionKey: 'confirm.removeRemote.description',
          confirmKey: 'branch.delete',
          params: { name },
          destructive: true
        });
        if (!ok) return;
        await this.mutate({
          run: () => gitClient.removeRemote({ path: this.repoPath, name })
        });
      });
    },

    async renameRemote(oldName: string) {
      return this.native(async () => {
        const name = await usePrompt().prompt({
          titleKey: 'sidebar.renameRemote',
          labelKey: 'form.remoteName.label',
          placeholderKey: 'form.remoteName.placeholder',
          submitKey: 'form.rename',
          initial: oldName,
          schema: remoteNameSchema
        });
        if (!name || name === oldName) return;
        await this.mutate({
          run: () =>
            gitClient.renameRemote({
              path: this.repoPath,
              oldName,
              newName: name
            })
        });
      });
    },

    // Check out a commit directly (detached HEAD) to inspect or branch off it.
    async checkoutCommit(hash: string) {
      return this.mutate({
        run: () => gitClient.checkoutCommit({ path: this.repoPath, hash })
      });
    },

    // Create a branch at a commit and switch to it (prompts for the name).
    async branchAt(hash: string) {
      return this.native(async () => {
        const name = await usePrompt().prompt({
          titleKey: 'commit.branchHere',
          labelKey: 'form.branch.label',
          descriptionKey: 'form.branch.description',
          placeholderKey: 'form.branch.placeholder',
          submitKey: 'form.create',
          schema: branchNameSchema
        });
        if (!name) return;
        await this.mutate({
          run: () =>
            gitClient.createBranchAt({ path: this.repoPath, name, hash })
        });
      });
    },

    // Tag a commit — opens the tag dialog (name + optional message / signing).
    tagAt(hash: string) {
      useTagCreate().show(hash);
    },

    // Invert a single commit. Reverting a merge prompts for the mainline parent
    // (1-based), which git requires (`-m`) there.
    async revert(hash: string) {
      return this.native(async () => {
        const commit = this.active?.commits.find((c) => c.hash === hash);
        let mainline: number | undefined;
        if (commit && commit.parents.length > 1) {
          const picked = await usePrompt().prompt({
            titleKey: 'commit.revertMerge.title',
            labelKey: 'commit.revertMerge.label',
            descriptionKey: 'commit.revertMerge.description',
            placeholderKey: 'commit.revertMerge.placeholder',
            submitKey: 'commit.revert',
            initial: '1',
            schema: mainlineSchema(commit.parents.length)
          });
          if (!picked) return;
          mainline = Number(picked);
        }
        await this.mutate({
          run: () =>
            gitClient.revert({ path: this.repoPath, hashes: [hash], mainline })
        });
      });
    },

    async cherryPick(hash: string) {
      return this.mutate({
        run: () => gitClient.cherryPick({ path: this.repoPath, hashes: [hash] })
      });
    },

    // The multi-selected hashes ordered oldest-first (the order cherry-pick and
    // revert want), derived from their position in the loaded log.
    orderedSelection(): string[] {
      const commits = this.active?.commits ?? [];
      const index = (h: string) => commits.findIndex((c) => c.hash === h);
      // commits are newest-first, so a higher index is older → sort descending.
      return [...this.multiSel].sort((a, b) => index(b) - index(a));
    },

    async cherryPickSelected() {
      const hashes = this.orderedSelection();
      if (!hashes.length) return;
      await this.mutate({
        run: () => gitClient.cherryPick({ path: this.repoPath, hashes })
      });
      this.multiSel = [];
    },

    async revertSelected() {
      const hashes = this.orderedSelection();
      if (!hashes.length) return;
      await this.mutate({
        run: () => gitClient.revert({ path: this.repoPath, hashes })
      });
      this.multiSel = [];
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
    }) {
      const commits = this.active?.commits ?? [];
      if (range) {
        const anchor =
          this.multiSel.at(-1) ?? this.active?.selectedHash ?? hash;
        const i = commits.findIndex((c) => c.hash === anchor);
        const j = commits.findIndex((c) => c.hash === hash);
        if (i >= 0 && j >= 0) {
          const [lo, hi] = i <= j ? [i, j] : [j, i];
          this.multiSel = commits.slice(lo, hi + 1).map((c) => c.hash);
          return;
        }
      }
      if (additive) {
        this.multiSel = this.multiSel.includes(hash)
          ? this.multiSel.filter((h) => h !== hash)
          : [...this.multiSel, hash];
        return;
      }
      void this.selectCommit(hash);
    },

    // Move the current branch to a commit. A hard reset discards working-tree
    // changes, so it confirms first.
    async reset({
      hash,
      mode
    }: {
      hash: string;
      mode: 'soft' | 'mixed' | 'hard';
    }) {
      return this.native(async () => {
        if (mode === 'hard') {
          const ok = await useConfirm().confirm({
            titleKey: 'confirm.resetHard.title',
            descriptionKey: 'confirm.resetHard.description',
            confirmKey: 'confirm.resetHard.confirm'
          });
          if (!ok) return;
        }
        await this.mutate({
          run: () => gitClient.reset({ path: this.repoPath, hash, mode })
        });
      });
    },

    // Undo the last HEAD-moving action by resetting hard to HEAD@{1} (the
    // previous reflog position) — recovers from a mistaken reset/rebase/merge/
    // commit. Working-tree changes are discarded, so it confirms first.
    async undoLast() {
      return this.native(async () => {
        const ok = await useConfirm().confirm({
          titleKey: 'reflog.undo.title',
          descriptionKey: 'reflog.undo.description',
          confirmKey: 'reflog.undo.confirm',
          destructive: true
        });
        if (!ok) return;
        await this.mutate({
          run: () =>
            gitClient.reset({
              path: this.repoPath,
              hash: 'HEAD@{1}',
              mode: 'hard'
            })
        });
      });
    },

    // Create a tag on HEAD — opens the tag dialog.
    createTagPrompt() {
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
    }) {
      const trimmed = name.trim();
      if (!trimmed) return;
      return this.mutate({
        run: () =>
          gitClient.createTag({
            path: this.repoPath,
            name: trimmed,
            hash,
            message: message.trim(),
            sign
          })
      });
    },

    // Export a commit to a .patch file (the caller picks `dest` via a dialog).
    async exportPatch({ hash, dest }: { hash: string; dest: string }) {
      return this.native(() =>
        gitClient.exportPatch({ path: this.repoPath, hash, dest })
      );
    },
    // Apply a patch file (`git am`) and reload — a conflict surfaces as an error.
    async applyPatch({ src }: { src: string }) {
      return this.native(async () => {
        await gitClient.applyPatch({ path: this.repoPath, src, mode: 'am' });
        await this.loadFromBackend(this.active?.path);
      });
    },

    async deleteTag(name: string) {
      return this.native(async () => {
        const ok = await useConfirm().confirm({
          titleKey: 'confirm.deleteTag.title',
          descriptionKey: 'confirm.deleteTag.description',
          confirmKey: 'branch.delete',
          params: { name },
          destructive: true
        });
        if (!ok) return;
        await this.mutate({
          run: () => gitClient.deleteTag({ path: this.repoPath, name })
        });
      });
    },

    async stashSave(
      opts: {
        message?: string;
        includeUntracked?: boolean;
        paths?: string[];
      } = {}
    ) {
      return this.mutate({
        run: () =>
          gitClient.stashSave({
            path: this.repoPath,
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
    }) {
      return this.native(async () => {
        if (action === 'drop') {
          const ok = await useConfirm().confirm({
            titleKey: 'confirm.dropStash.title',
            descriptionKey: 'confirm.dropStash.description',
            confirmKey: 'sidebar.stashDrop',
            destructive: true
          });
          if (!ok) return;
        }
        await this.mutate({
          run: async () => {
            if (action === 'pop')
              await gitClient.stashPop({ path: this.repoPath, reference });
            else if (action === 'apply')
              await gitClient.stashApply({ path: this.repoPath, reference });
            else await gitClient.stashDrop({ path: this.repoPath, reference });
          }
        });
      });
    },

    async sync(command: 'fetch' | 'pull' | 'push') {
      return this.native(async () => {
        this.syncing = command;
        this.busy = true;
        this.lastError = null;
        try {
          await Promise.all([
            this.doSync(command),
            promiseTimeout(MIN_SPINNER_MS)
          ]);
        } finally {
          this.busy = false;
          this.syncing = null;
        }
      });
    },

    // Pull with the given strategy, or the user's configured default when none
    // is passed (the plain pull-button click). The backend always gets an
    // explicit strategy, so git never aborts on "how to reconcile".
    async doPull(strategy?: PullStrategy) {
      await gitClient.pull({
        path: this.repoPath,
        strategy: strategy ?? useSettingsStore().pullStrategy
      });
    },

    // Runs a sync, turning the "no upstream / no tracking" failures into a
    // helpful prompt (publish branch / set upstream) instead of a raw error,
    // and a diverged-branches failure into a strategy chooser. `strategy`
    // overrides the configured default for this one pull.
    async doSync(command: 'fetch' | 'pull' | 'push', strategy?: PullStrategy) {
      try {
        if (command === 'pull') await this.doPull(strategy);
        else if (command === 'push')
          await gitClient.push({ path: this.repoPath });
        else await gitClient.fetch(this.repoPath);
        await this.loadFromBackend(this.active?.path);
      } catch (err) {
        const raw = typeof err === 'string' ? err : String(err);
        // A pull that can't fast-forward (e.g. --ff-only on diverged branches)
        // isn't a hard error — let the user pick how to reconcile, then retry.
        if (
          command === 'pull' &&
          /not possible to fast-forward|reconcile divergent|diverging|divergent branches/i.test(
            raw
          )
        ) {
          const choice = await usePullStrategy().choose({
            initial: useSettingsStore().pullStrategy
          });
          if (!choice) return;
          try {
            await this.doPull(choice);
            await this.loadFromBackend(this.active?.path);
          } catch (retryErr) {
            this.lastError = cleanGitError(String(retryErr));
          }
          return;
        }
        if (command === 'push' && /upstream/i.test(raw)) {
          const ok = await useConfirm().confirm({
            titleKey: 'confirm.publishBranch.title',
            descriptionKey: 'confirm.publishBranch.description',
            confirmKey: 'confirm.publishBranch.confirm'
          });
          if (ok) {
            await gitClient.push({
              path: this.repoPath,
              setUpstream: true,
              force: false
            });
            await this.loadFromBackend(this.active?.path);
          }
          return;
        }
        if (
          command === 'pull' &&
          /no tracking information|upstream/i.test(raw)
        ) {
          const ok = await useConfirm().confirm({
            titleKey: 'confirm.setUpstream.title',
            descriptionKey: 'confirm.setUpstream.description',
            confirmKey: 'confirm.setUpstream.confirm'
          });
          if (ok) {
            await gitClient.setUpstream({
              path: this.repoPath,
              remote: 'origin',
              branch: this.currentBranch
            });
            await this.doPull();
            await this.loadFromBackend(this.active?.path);
          }
          return;
        }
        this.lastError = cleanGitError(raw);
        console.error('sync failed:', err);
      }
    },

    // Pull with an explicit strategy (the pull-button dropdown), as opposed to
    // sync('pull') which uses the configured default. Shares the pull spinner/
    // guard and the same diverged-branches handling via doSync.
    async pull({ strategy }: { strategy: PullStrategy }) {
      return this.native(async () => {
        this.syncing = 'pull';
        this.busy = true;
        this.lastError = null;
        try {
          await Promise.all([
            this.doSync('pull', strategy),
            promiseTimeout(MIN_SPINNER_MS)
          ]);
        } finally {
          this.busy = false;
          this.syncing = null;
        }
      });
    },

    // Push with options: publish a new branch (set upstream) and/or force with
    // lease. Shares the push spinner/guard with the plain sync('push').
    async push({
      setUpstream,
      force
    }: {
      setUpstream: boolean;
      force: boolean;
    }) {
      return this.native(async () => {
        this.syncing = 'push';
        try {
          await Promise.all([
            this.guarded(async () => {
              await gitClient.push({ path: this.repoPath, setUpstream, force });
              await this.loadFromBackend(this.active?.path);
            }),
            promiseTimeout(MIN_SPINNER_MS)
          ]);
        } finally {
          this.syncing = null;
        }
      });
    },

    // Open the active repo's folder in an external app.
    async openIn(app: 'files' | 'terminal' | 'editor') {
      if (!this.active) return;
      const path = this.active.path;
      return this.mutate({
        run: () => gitClient.openIn({ path, app }),
        refresh: 'none'
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
      this.syncSession();
    },

    // Persist a new tab order after a drag-and-drop reorder.
    reorderTabs(order: string[]) {
      this.order = order;
      this.syncSession();
    },

    // The single Native/Browser gate for store effects. Runs `fn` only inside
    // the desktop shell; in the browser demo it's a no-op so the mock data
    // stays put. Every action that reaches the git backend — or shows a git
    // dialog that only makes sense against a real repo — goes through here, so
    // the `isTauri()` check lives in one place instead of at each call site.
    async native<T>(fn: () => Promise<T> | T): Promise<T | undefined> {
      if (!isTauri()) return;
      return fn();
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

    // The shape almost every mutating action shares: skip outside Tauri, run the
    // git call under `guarded` (busy flag + error surfacing), then refresh.
    // `refresh` picks how the view re-syncs — 'reload' re-reads the whole repo
    // (the default), 'status' refreshes the working-tree status + current diff,
    // 'none' leaves any view update to `run` itself.
    async mutate({
      run,
      refresh = 'reload'
    }: {
      run: () => Promise<unknown>;
      refresh?: 'reload' | 'status' | 'none';
    }) {
      return this.native(() =>
        this.guarded(async () => {
          await run();
          if (refresh === 'reload')
            await this.loadFromBackend(this.active?.path);
          else if (refresh === 'status') {
            await this.loadStatus();
            await this.reDiff();
          }
        })
      );
    },

    clearError() {
      this.lastError = null;
    },

    // `target` lets a load write into a specific repo rather than whatever is
    // active *now* — the active tab can change mid-load (user switches tabs),
    // and the result must land in the repo it was fetched for, not the new one.
    async loadStatus(target?: RepoState) {
      return this.native(async () => {
        const r = target ?? this.active;
        if (!r) return;
        r.status = await gitClient.status(r.path);
      });
    },

    async loadLog(target?: RepoState) {
      return this.native(async () => {
        const r = target ?? this.active;
        if (!r) return;
        const commits = await gitClient.log({
          path: r.path,
          limit: this.logLimit
        });
        if (commits.length) r.commits = commits;
        // Hitting the limit means git had more to give → another page exists.
        this.hasMore = commits.length >= this.logLimit;
      });
    },

    // Load another page of history (raise the log limit and reload). The button
    // stays put and shows a spinner; `hasMore` only flips after the reload, so it
    // hides only when there is genuinely nothing left. A 300ms floor keeps the
    // spinner from flashing on fast local loads.
    async loadMoreHistory() {
      if (this.loadingMore) return;
      return this.native(async () => {
        this.loadingMore = true;
        this.logLimit += 200;
        try {
          await Promise.all([
            this.loadLog(),
            new Promise((resolve) => setTimeout(resolve, 300))
          ]);
        } finally {
          this.loadingMore = false;
        }
      });
    },

    async refresh() {
      // The window-focus listener fires this unconditionally, including on the
      // start screen where there is no active repo — guard the deref.
      if (!this.active) return;
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
    // an already-open repo just focuses its tab. Serialized via `openChain` so
    // two rapid calls can't both miss the dedup and create duplicate tabs.
    async openRepo(path: string) {
      const run = openChain.then(
        () => this.doOpenRepo(path),
        () => this.doOpenRepo(path)
      );
      openChain = run.catch(() => {});
      return run;
    },

    async doOpenRepo(path: string) {
      return this.native(() =>
        this.guarded(async () => {
          // Fast path: a tab for this exact path is already open. Done
          // synchronously (no await) so it can't race a concurrent open.
          const known = this.tabs.find((r) => r.path === path);
          if (known) {
            this.selectTab(known.id);
            return;
          }
          // Pop a provisional tab immediately at the requested path so opening
          // feels instant; its toplevel/flavor/distro are reconciled below from
          // a single `info` probe (the tab icon shows a spinner until then,
          // never the wrong-distro penguin).
          this.seq += 1;
          const id = `r${this.seq}`;
          this.repos[id] = blankRepo({ id, path });
          this.order.push(id);
          this.activeId = id;

          let info: RepoInfo;
          try {
            info = await gitClient.info(path);
          } catch (err) {
            // The probe failed (not a repo / unreadable): drop the provisional
            // tab and let `guarded` surface the error.
            this.closeRepo(id);
            throw err;
          }
          const top = info.toplevel || path;

          // Toplevel dedup: opening a subdir of an already-open repo focuses the
          // existing tab and discards the provisional one.
          const existing = this.tabs.find((r) => r.id !== id && r.path === top);
          if (existing) {
            this.closeRepo(id);
            this.selectTab(existing.id);
            return;
          }
          // The user may have closed the provisional tab during the probe.
          if (!this.repos[id]) return;
          await this.loadFromBackend(top, { info, target: this.repos[id] });
          this.syncSession();
        })
      );
    },

    // Retry the active repo's load after a failure (inline error → retry).
    async retryLoad() {
      await this.loadFromBackend(this.active?.path);
    },

    // Load real git output into the active repo. Without a path it resolves the
    // process CWD (initial open); with one it (re)loads that repo's tab.
    // `opts.target` writes into a specific tab instead of whatever is active now
    // (used by `doOpenRepo`, whose provisional tab may not stay active across
    // the load); `opts.info` feeds an already-fetched probe so the open path
    // doesn't pay for a second `info` round-trip.
    async loadFromBackend(
      path?: string,
      opts?: { info?: RepoInfo; target?: RepoState }
    ) {
      // Capture the target repo SYNCHRONOUSLY, before any await. The active tab
      // can change while we're loading (the user switches/opens another repo),
      // and this load's result must land in the repo it was started for — not
      // whatever happens to be active when the awaits resolve. Reading
      // `this.active` lazily after an await is what let one project's data leak
      // into another's tab.
      const r = opts?.target ?? this.active;
      if (!r) return;
      return this.native(async () => {
        this.loading = true;
        this.loadError = null;
        try {
          const start = path ?? (await gitClient.defaultRepo());
          const info = opts?.info ?? (await gitClient.info(start));
          const top = info.toplevel || start;

          r.name = top.split(/[\\/]/).pop() || 'repo';
          r.path = top;
          r.flavor = (info.flavor as GitFlavor) ?? 'linux';
          r.distro = info.distro ?? undefined;
          // Platform is known now — settle the tab icon before the heavier log/
          // status load finishes.
          r.resolving = false;
          r.branches = info.branches;
          r.remoteBranches = info.remoteBranches;
          r.currentBranch = info.currentBranch;
          r.remotes = info.remotes;
          r.tags = info.tags;
          r.stashes = info.stashes;
          r.rebaseInProgress = info.rebaseInProgress;
          r.bisectInProgress = info.bisectInProgress;

          await Promise.all([this.loadLog(r), this.loadStatus(r)]);
          // Data is in: mark the tab loaded so it won't re-fetch on the next
          // activation (the selection below is incidental).
          r.loaded = true;

          // Bail if the active repo changed while we were loading (e.g. the
          // user opened another project): the selection below reads
          // `this.active` freshly, so a stale commit hash would hit the wrong
          // repo ("bad object"). The owning load will finish its own selection.
          if (this.active !== r) return;

          // Preserve the user's selection across a reload (e.g. on window
          // focus) instead of jumping back to the first commit/file; fall back
          // to a default only when the previous selection is gone. The decision
          // lives in the pure restoreSelection strategy.
          const first = this.unstagedFiles[0] ?? this.stagedFiles[0];
          const target = restoreSelection({
            prevHash: r.selectedHash,
            prevFile: r.selectedFile,
            prevFileStaged: r.selectedFileStaged,
            commitHashes: r.commits.map((c) => c.hash),
            statusPaths: r.status.map((f) => f.path),
            defaultFile: first
              ? {
                  file: first.path,
                  staged: !first.unstaged && !first.untracked
                }
              : null,
            defaultHash: r.commits[0]?.hash ?? null
          });
          if (target.kind === 'commit') await this.selectCommit(target.hash);
          else if (target.kind === 'file')
            await this.selectFile({ file: target.file, staged: target.staged });
          else r.diff = null;

          useRecentStore().push({ path: top, name: r.name });
          this.watchActive();
        } catch (err) {
          const raw = typeof err === 'string' ? err : String(err);
          this.loadError = cleanGitError(raw);
          console.error('loadFromBackend failed:', err);
        } finally {
          this.loading = false;
          // Stop the icon spinner even when the probe failed or the tab was
          // switched away mid-load, so it never spins forever.
          r.resolving = false;
        }
      });
    },

    // Settle the platform (flavor/distro) for WSL placeholder tabs that haven't
    // been activated yet, so their tab icon resolves in the background instead
    // of spinning until the user clicks the tab. Metadata only — the full repo
    // load still happens lazily on first activation.
    async resolveTabPlatforms() {
      return this.native(async () => {
        const pending = this.tabs.filter(
          (r) => r.resolving && !r.loaded && !resolvingPlatform.has(r.id)
        );
        await Promise.all(
          pending.map(async (r) => {
            resolvingPlatform.add(r.id);
            try {
              const info = await gitClient.info(r.path);
              // Apply only if a full load hasn't already overtaken this probe.
              const tab = this.repos[r.id];
              if (tab && !tab.loaded) {
                tab.flavor = (info.flavor as GitFlavor) ?? tab.flavor;
                tab.distro = info.distro ?? undefined;
              }
            } catch {
              // Best effort: a real activation will surface any error inline.
            } finally {
              const tab = this.repos[r.id];
              if (tab) tab.resolving = false;
              resolvingPlatform.delete(r.id);
            }
          })
        );
      });
    }
  }
});

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRepoStore, import.meta.hot));
}
