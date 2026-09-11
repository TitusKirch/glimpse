// Reading a repository into a tab: status, log, another page of history, and
// the full load that fills a tab from a single `info` probe plus those two.
//
// One rule runs through the whole file and is the reason it is worth reading as
// a unit: a load captures the repo it is *for* before its first await, and
// writes only into that. The active tab can change while git is answering, and
// a result that lands on `this.active` at resolve time lands on the wrong
// repository — which is how one project's history once appeared under another
// project's name.
import { markRaw } from 'vue';
import { promiseTimeout } from '@vueuse/core';
import type { RepoInfo } from '~/types/bindings';
import { useRepoStore } from '~/stores/repo';
import type { GitFlavor, RepoState } from '~/stores/repo/state';
import { LOG_PAGE, MIN_SPINNER_MS } from '~/stores/repo/state';

export const loadingActions = {
  // Point the backend FS watcher at the active repo (live-refresh source).
  watchActive(): void {
    const s = useRepoStore();
    if (isTauri() && s.active) void gitClient.watchRepo(s.active.path);
  },

  // Light refresh used by the watcher: reload status + log, keep selection.
  async reloadActive(): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      try {
        await Promise.all([s.loadStatus(), s.loadLog()]);
      } catch (err) {
        // Nobody awaits this one — the FS watcher fires it — so a failure
        // escaped as an unhandled rejection and was toasted by the app-wide
        // net instead, once per event and outside the grouping every other
        // git failure gets. A watcher burst against a git that fails then
        // papered the screen. Surfaced like any other git failure instead.
        const raw = typeof err === 'string' ? err : String(err);
        s.lastError = cleanGitError(raw);
        console.error('reload failed:', err);
      }
    });
  },

  // `target` lets a load write into a specific repo rather than whatever is
  // active *now* — the active tab can change mid-load (user switches tabs),
  // and the result must land in the repo it was fetched for, not the new one.
  async loadStatus(target?: RepoState): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const r = target ?? s.active;
      if (!r) return;
      r.status = markRaw(await gitClient.status(r.path));
    });
  },

  async loadLog(target?: RepoState): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const r = target ?? s.active;
      if (!r) return;
      const commits = await gitClient.log({
        path: r.path,
        limit: r.logLimit
      });
      // markRaw for the same reason `status` and `diff` carry it: this is the
      // largest payload in the store and the one that scales with `logLimit`,
      // and every reader replaces the list wholesale rather than mutating it.
      if (commits.length) r.commits = markRaw(commits);
      // Hitting the limit means git had more to give → another page exists.
      r.hasMore = commits.length >= r.logLimit;
    });
  },

  // Load another page of history (raise this tab's log limit and reload). The
  // button stays put and shows a spinner; `hasMore` only flips after the
  // reload, so it hides only when there is genuinely nothing left. A 300ms
  // floor keeps the spinner from flashing on fast local loads.
  async loadMoreHistory(): Promise<void> {
    const s = useRepoStore();
    if (s.loadingMore) return;
    // Capture the repo that asked before any await. The user can switch tabs
    // while the deeper page is in flight, and both the raise and the reload it
    // pays for must land on the repository whose button was clicked, not on
    // whichever tab happens to be active when it resolves.
    const r = s.active;
    if (!r) return;
    await s.native(async () => {
      s.loadingMore = true;
      r.logLimit += LOG_PAGE;
      try {
        await Promise.all([
          s.loadLog(r),
          new Promise((resolve) => setTimeout(resolve, 300))
        ]);
      } finally {
        s.loadingMore = false;
      }
    });
  },

  async refresh(): Promise<void> {
    const s = useRepoStore();
    // The window-focus listener fires this unconditionally, including on the
    // start screen where there is no active repo — guard the deref.
    if (!s.active) return;
    s.lastRefresh = 'just now';
    s.refreshing = true;
    try {
      // Reload the active repo by its own path — not the process CWD, which
      // would overwrite another opened repo's tab with glimpse itself.
      await Promise.all([
        s.loadFromBackend(s.active.path),
        promiseTimeout(MIN_SPINNER_MS)
      ]);
    } finally {
      s.refreshing = false;
    }
  },

  // Retry the active repo's load after a failure (inline error → retry).
  async retryLoad(): Promise<void> {
    const s = useRepoStore();
    await s.loadFromBackend(s.active?.path);
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
  ): Promise<void> {
    const s = useRepoStore();
    // Capture the target repo SYNCHRONOUSLY, before any await. The active tab
    // can change while we're loading (the user switches/opens another repo),
    // and this load's result must land in the repo it was started for — not
    // whatever happens to be active when the awaits resolve. Reading
    // `s.active` lazily after an await is what let one project's data leak
    // into another's tab.
    const r = opts?.target ?? s.active;
    if (!r) return;
    await s.native(async () => {
      s.loading = true;
      r.loadError = null;
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

        await Promise.all([s.loadLog(r), s.loadStatus(r)]);
        // Data is in: mark the tab loaded so it won't re-fetch on the next
        // activation (the selection below is incidental).
        r.loaded = true;

        // Bail if the active repo changed while we were loading (e.g. the
        // user opened another project): the selection below reads
        // `s.active` freshly, so a stale commit hash would hit the wrong
        // repo ("bad object"). The owning load will finish its own selection.
        if (s.active !== r) return;

        // Preserve the user's selection across a reload (e.g. on window
        // focus) instead of jumping back to the first commit/file; fall back
        // to a default only when the previous selection is gone. The decision
        // lives in the pure restoreSelection strategy.
        const first = s.unstagedFiles[0] ?? s.stagedFiles[0];
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
        if (target.kind === 'commit') await s.selectCommit(target.hash);
        else if (target.kind === 'file')
          await s.selectFile({ file: target.file, staged: target.staged });
        else r.diff = null;

        useRecentStore().push({ path: top, name: r.name });
        s.watchActive();
      } catch (err) {
        const raw = typeof err === 'string' ? err : String(err);
        r.loadError = cleanGitError(raw);
        console.error('loadFromBackend failed:', err);
      } finally {
        s.loading = false;
        // Stop the icon spinner even when the probe failed or the tab was
        // switched away mid-load, so it never spins forever.
        r.resolving = false;
      }
    });
  }
};
