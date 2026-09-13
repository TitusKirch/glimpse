// The multi-repo tab strip: opening, activating, restoring, releasing and
// closing repository tabs.
//
// A tab is cheap to create and expensive to keep: it holds a full commit list
// and a diff. So the lifecycle here is deliberately two-sided — a tab is opened
// as a placeholder and filled lazily on first activation, and handed back again
// once it falls outside MAX_LOADED_TABS. Both directions go through the same
// placeholder shape, which is why a released tab reloads exactly like a
// restored one.
import { useRepoStore } from '~/stores/repo';
import {
  blankRepo,
  MAX_LOADED_TABS,
  nextActivation,
  resolvingPlatform
} from '~/stores/repo/state';
import type { GitFlavor } from '~/stores/repo/state';
import type { RepoInfo } from '~/types/bindings';

// Serializes repo opening. Concurrent/rapid openRepo calls (double-clicking a
// recent, switching while another open is mid-flight) would otherwise interleave
// on the async `info` resolve and create a duplicate tab. Chaining them makes
// each open see the tabs the previous one created.
let openChain: Promise<unknown> = Promise.resolve();

export const tabActions = {
  async selectTab(id: string): Promise<void> {
    const s = useRepoStore();
    if (!s.repos[id]) return;
    s.activeId = id;
    s.multiSel = [];
    // Stamp before releasing, so the tab just activated is the most recent one
    // and can never be the tab that gets dropped.
    s.repos[id]!.lastActive = nextActivation();
    s.releaseIdleTabs();
    s.watchActive();
    s.syncSession();
    // Lazy-load a restored placeholder on first activation; cached afterwards,
    // so re-selecting an already-loaded tab is instant. A released tab comes
    // back through this same path.
    if (!s.repos[id]!.loaded) {
      await s.loadFromBackend(s.repos[id]!.path);
    }
  },

  // Hand back the data of every tab that has fallen outside MAX_LOADED_TABS.
  // Activation is the only moment the ordering can change, so this runs from
  // selectTab and from opening a repo, rather than on a timer.
  releaseIdleTabs(): void {
    const s = useRepoStore();
    // Sort a copy: `tabs` is a cached getter, and sorting it in place would
    // reorder the tab strip itself.
    const idle = [...s.tabs]
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(MAX_LOADED_TABS);
    for (const r of idle) s.releaseTab(r.id);
  },

  // Drop an idle tab's bulk data and put it back into the placeholder state a
  // restored tab starts in, so its next activation reloads it exactly the way
  // restoreSession's placeholders do.
  //
  // Everything dropped here is re-readable from git. What is deliberately kept
  // is what a reload could not rediscover: the tab's identity (name, path,
  // flavor, distro — the tab strip renders it), and the selection, which
  // loadFromBackend feeds to restoreSelection. Dropping the selection would
  // silently move the user back to the newest commit on re-activation, which
  // is the kind of invisible loss that would make this trade a regression
  // rather than a saving. The ref metadata (branches, remotes, tags, stashes)
  // is kept too: it is O(refs), not O(history), and keeping it lets the
  // reloading tab paint its last known branch instead of going blank.
  releaseTab(id: string): void {
    const s = useRepoStore();
    const r = s.repos[id];
    // Never the active tab: it is on screen, and releasing it would blank the
    // view and immediately reload it.
    if (!r || !r.loaded || id === s.activeId) return;
    r.commits = [];
    r.status = [];
    r.commitFiles = [];
    r.selectedBody = '';
    r.diff = null;
    r.loaded = false;
  },

  // Persist the open repo paths + active path so the tabs reopen next launch.
  syncSession(): void {
    const s = useRepoStore();
    void s.native(() => {
      const session = useSessionStore();
      session.openPaths = s.order.map((id) => s.repos[id]!.path);
      session.activePath = s.active?.path ?? '';
      session.initialized = true;
    });
  },

  // Reopen the previous session's tabs. First-ever launch (not initialized)
  // opens the process CWD; if the user had closed every tab, show the start
  // screen instead of forcing the CWD back open.
  async restoreSession(): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const session = useSessionStore();
      if (!session.initialized) {
        await s.loadFromBackend();
        s.syncSession();
        return;
      }
      const paths = [...session.openPaths];
      const activePath = session.activePath;
      // Rebuild instantly as lightweight placeholders (no backend call) so the
      // tab strip paints immediately — no start-screen flash and no waiting for
      // every repo to load. Only the active repo loads now; the rest lazy-load
      // on first activation. Validation is deferred too: an invalid repo shows
      // an inline error on its tab instead of silently vanishing here.
      s.repos = {};
      s.order = [];
      s.activeId = '';
      for (const p of paths) {
        s.seq += 1;
        const id = `r${s.seq}`;
        s.repos[id] = blankRepo({ id, path: p });
        s.order.push(id);
      }
      const target = s.tabs.find((t) => t.path === activePath) ?? s.tabs[0];
      if (target) await s.selectTab(target.id);
      s.syncSession();
      // First repo is loaded — settle the other tabs' platform icons in the
      // background so they don't spin until the user clicks each one.
      void s.resolveTabPlatforms();
    });
  },

  // Initialise a new repository in `parent` (optional initial branch) and open
  // it in a tab. Returns the new path; errors propagate so the dialog can toast.
  async initRepo({
    parent,
    branch
  }: {
    parent: string;
    branch?: string;
  }): Promise<string | undefined> {
    const s = useRepoStore();
    return s.native(async () => {
      const path = await gitClient.initRepo({ path: parent, branch });
      if (path) await s.openRepo(path);
      return path;
    });
  },

  // Clone `url` into `parent` and open the new repo in a tab. Returns the new
  // path; errors propagate so the dialog can toast.
  async cloneRepo({
    url,
    parent
  }: {
    url: string;
    parent: string;
  }): Promise<string | undefined> {
    const s = useRepoStore();
    return s.native(async () => {
      const path = await gitClient.cloneRepo({ path: parent, url });
      if (path) await s.openRepo(path);
      return path;
    });
  },

  // Open a folder as an additional repository tab and activate it. Re-opening
  // an already-open repo just focuses its tab. Serialized via `openChain` so
  // two rapid calls can't both miss the dedup and create duplicate tabs.
  async openRepo(path: string): Promise<void> {
    const s = useRepoStore();
    const run = openChain.then(
      () => s.doOpenRepo(path),
      () => s.doOpenRepo(path)
    );
    openChain = run.catch(() => {});
    return run;
  },

  async doOpenRepo(path: string): Promise<void> {
    const s = useRepoStore();
    await s.native(() =>
      s.guarded(async () => {
        // Fast path: a tab for this exact path is already open. Done
        // synchronously (no await) so it can't race a concurrent open.
        const known = s.tabs.find((r) => r.path === path);
        if (known) {
          s.selectTab(known.id);
          return;
        }
        // Pop a provisional tab immediately at the requested path so opening
        // feels instant; its toplevel/flavor/distro are reconciled below from
        // a single `info` probe (the tab icon shows a spinner until then,
        // never the wrong-distro penguin).
        s.seq += 1;
        const id = `r${s.seq}`;
        s.repos[id] = blankRepo({ id, path });
        s.order.push(id);
        s.activeId = id;
        // Opening activates a tab without going through selectTab, so the
        // release has to run here too — otherwise opening repo after repo
        // holds every one of their histories at once.
        s.releaseIdleTabs();

        let info: RepoInfo;
        try {
          info = await gitClient.info(path);
        } catch (err) {
          // The probe failed (not a repo / unreadable): drop the provisional
          // tab and let `guarded` surface the error.
          s.closeRepo(id);
          throw err;
        }
        const top = info.toplevel || path;

        // Toplevel dedup: opening a subdir of an already-open repo focuses the
        // existing tab and discards the provisional one.
        const existing = s.tabs.find((r) => r.id !== id && r.path === top);
        if (existing) {
          s.closeRepo(id);
          s.selectTab(existing.id);
          return;
        }
        // The user may have closed the provisional tab during the probe.
        if (!s.repos[id]) return;
        await s.loadFromBackend(top, { info, target: s.repos[id] });
        s.syncSession();
      })
    );
  },

  // Settle the platform (flavor/distro) for WSL placeholder tabs that haven't
  // been activated yet, so their tab icon resolves in the background instead
  // of spinning until the user clicks the tab. Metadata only — the full repo
  // load still happens lazily on first activation.
  async resolveTabPlatforms(): Promise<void> {
    const s = useRepoStore();
    await s.native(async () => {
      const pending = s.tabs.filter(
        (r) => r.resolving && !r.loaded && !resolvingPlatform.has(r.id)
      );
      await Promise.all(
        pending.map(async (r) => {
          resolvingPlatform.add(r.id);
          try {
            const info = await gitClient.info(r.path);
            // Apply only if a full load hasn't already overtaken this probe.
            const tab = s.repos[r.id];
            if (tab && !tab.loaded) {
              tab.flavor = (info.flavor as GitFlavor) ?? tab.flavor;
              tab.distro = info.distro ?? undefined;
            }
          } catch {
            // Best effort: a real activation will surface any error inline.
          } finally {
            const tab = s.repos[r.id];
            if (tab) tab.resolving = false;
            resolvingPlatform.delete(r.id);
          }
        })
      );
    });
  },

  // Close a repo tab. Activates a neighbour; leaves activeId pointing at a
  // closed id only when nothing remains (the start screen then shows).
  closeRepo(id: string): void {
    const s = useRepoStore();
    const closing = s.repos[id];
    if (!closing) return;
    // A platform probe may still be running for this tab — `doOpenRepo`
    // closes its provisional tab from under one on a failed `info` and on
    // toplevel dedup, and the user can close a still-spinning tab by hand.
    // Release the claim with the tab rather than waiting for that probe to
    // land: until then the set claims a probe for a tab that is gone, and
    // since tab ids come from a monotonic counter and never repeat, nothing
    // else would ever clear it. The probe's own `finally` still runs; a
    // second delete of the same id is a no-op.
    resolvingPlatform.delete(id);
    const idx = s.order.indexOf(id);
    delete s.repos[id];
    s.order = s.order.filter((x) => x !== id);
    // Release the closed repo's changelist bookkeeping, which is otherwise
    // resident for the rest of the session (and, persisted, beyond it). It is
    // keyed by path, so keep it while another tab still shows the same repo.
    if (!s.tabs.some((t) => t.path === closing.path))
      // `release` flushes a pending edit, so it can reject on a real write.
      // Nobody awaits it — closing a tab must not block on git — so route the
      // failure the way `reloadActive` does rather than letting it escape as
      // an unhandled rejection: it would be the user's last changelist edit
      // going missing with nothing said.
      useChangelistsStore()
        .release(closing.path)
        .catch((err: unknown) => {
          const raw = typeof err === 'string' ? err : String(err);
          s.lastError = cleanGitError(raw);
          console.error('changelist release failed:', err);
        });
    if (s.activeId === id) {
      const next = s.order[idx] ?? s.order[idx - 1] ?? '';
      // Route the neighbour through selectTab rather than just pointing
      // activeId at it: a close is an activation, and the neighbour may be a
      // placeholder — restored, or released while it sat idle — which nothing
      // else would ever load, leaving empty panels on the repo the user is now
      // looking at. Not awaited: closing a tab must not block on git.
      if (next) void s.selectTab(next);
      else s.activeId = next;
    }
    s.syncSession();
  },

  // Persist a new tab order after a drag-and-drop reorder.
  reorderTabs(order: string[]): void {
    const s = useRepoStore();
    s.order = order;
    s.syncSession();
  },

  // Open the active repo's folder in an external app.
  async openIn(app: 'files' | 'terminal' | 'editor'): Promise<void> {
    const s = useRepoStore();
    if (!s.active) return;
    const path = s.active.path;
    await s.mutate({
      run: () => gitClient.openIn({ path, app }),
      refresh: 'none'
    });
  }
};
