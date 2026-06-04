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
import type {
  BlameLine,
  Branch,
  Commit,
  CommitFile,
  DiffData,
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
    loaded: true
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
    loaded: false
  };
}

// Serializes repo opening. Concurrent/rapid openRepo calls (double-clicking a
// recent, switching while another open is mid-flight) would otherwise interleave
// on the async `info` resolve and create a duplicate tab. Chaining them makes
// each open see the tabs the previous one created.
let openChain: Promise<unknown> = Promise.resolve();

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

    async stage(file: string) {
      return this.native(async () => {
        await gitClient.stage({ path: this.repoPath, file });
        await this.loadStatus();
        if (this.active.selectedFile === file)
          await this.selectFile({ file, staged: true });
      });
    },

    async unstage(file: string) {
      return this.native(async () => {
        await gitClient.unstage({ path: this.repoPath, file });
        await this.loadStatus();
        if (this.active.selectedFile === file)
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
          await gitClient.discard({ path: this.repoPath, file, untracked });
          await this.loadStatus();
          if (this.active.selectedFile === file) this.active.diff = null;
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

    async createBranch(name: string) {
      const trimmed = name.trim();
      if (!trimmed) return;
      return this.mutate({
        run: () =>
          gitClient.createBranch({ path: this.repoPath, name: trimmed })
      });
    },

    async deleteBranch(name: string) {
      return this.native(async () => {
        const ok = await useConfirm().confirm({
          titleKey: 'confirm.deleteBranch.title',
          descriptionKey: 'confirm.deleteBranch.description',
          confirmKey: 'branch.delete',
          params: { name },
          destructive: true
        });
        if (!ok) return;
        await this.mutate({
          run: () => gitClient.deleteBranch({ path: this.repoPath, name })
        });
      });
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

    // Tag a commit (prompts for the tag name).
    async tagAt(hash: string) {
      return this.native(async () => {
        const name = await usePrompt().prompt({
          titleKey: 'commit.tagHere',
          labelKey: 'form.tag.label',
          placeholderKey: 'form.tag.placeholder',
          submitKey: 'form.create',
          schema: tagNameSchema
        });
        if (!name) return;
        await this.createTag({ name, hash });
      });
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

    // Create a tag on HEAD via a name prompt.
    async createTagPrompt() {
      return this.native(async () => {
        const name = await usePrompt().prompt({
          titleKey: 'sidebar.newTag',
          labelKey: 'form.tag.label',
          placeholderKey: 'form.tag.placeholder',
          submitKey: 'form.create',
          schema: tagNameSchema
        });
        if (name) await this.createTag({ name });
      });
    },

    async createTag({ name, hash = '' }: { name: string; hash?: string }) {
      const trimmed = name.trim();
      if (!trimmed) return;
      return this.mutate({
        run: () =>
          gitClient.createTag({ path: this.repoPath, name: trimmed, hash })
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
          const top = (await gitClient.info(path)).toplevel || path;
          const existing = this.tabs.find((r) => r.path === top);
          if (existing) {
            this.selectTab(existing.id);
            return;
          }
          this.seq += 1;
          const id = `r${this.seq}`;
          this.repos[id] = blankRepo({ id, path: top });
          this.order.push(id);
          this.activeId = id;
          await this.loadFromBackend(top);
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
    async loadFromBackend(path?: string) {
      // Capture the target repo SYNCHRONOUSLY, before any await. The active tab
      // can change while we're loading (the user switches/opens another repo),
      // and this load's result must land in the repo it was started for — not
      // whatever happens to be active when the awaits resolve. Reading
      // `this.active` lazily after an await is what let one project's data leak
      // into another's tab.
      const r = this.active;
      if (!r) return;
      return this.native(async () => {
        this.loading = true;
        this.loadError = null;
        try {
          const start = path ?? (await gitClient.defaultRepo());
          const info = await gitClient.info(start);
          const top = info.toplevel || start;

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
          // focus) instead of jumping back to the first commit/file. Only fall
          // back to a default selection on the initial load.
          const keepCommit =
            r.selectedHash && r.commits.some((c) => c.hash === r.selectedHash);
          const keepFile =
            !r.selectedHash &&
            r.selectedFile &&
            r.status.some((f) => f.path === r.selectedFile);

          if (keepCommit) {
            await this.selectCommit(r.selectedHash!);
          } else if (keepFile) {
            await this.selectFile({
              file: r.selectedFile!,
              staged: r.selectedFileStaged
            });
          } else {
            // Open the first changed file (or the newest commit) by default.
            const first = this.unstagedFiles[0] ?? this.stagedFiles[0];
            if (first) {
              await this.selectFile({
                file: first.path,
                staged: !first.unstaged && !first.untracked
              });
            } else if (r.commits[0]) {
              await this.selectCommit(r.commits[0].hash);
            } else {
              r.diff = null;
            }
          }

          useRecentStore().push({ path: top, name: r.name });
          this.watchActive();
        } catch (err) {
          const raw = typeof err === 'string' ? err : String(err);
          this.loadError = cleanGitError(raw);
          console.error('loadFromBackend failed:', err);
        } finally {
          this.loading = false;
        }
      });
    }
  }
});

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRepoStore, import.meta.hot));
}
