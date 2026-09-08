// Per-repo changelist membership (which changed file is in which named group).
//
// The source of truth is a JSON file in the git dir (`<git-dir>/glimpse/
// changelists.json`, written by the backend) so membership travels with the
// working copy and any external tool — the CLI, an AI agent — can read/write it
// by the same documented shape (see ~/utils/changelist `serialize`). The store
// keeps a reactive in-memory copy so the panel stays synchronous, mirrors it to
// localStorage as a cache (instant on boot, and the only backing in the browser
// demo where there is no git dir), and persists real changes back to the file
// (debounced, atomic). Thin wrappers over the pure model; one entry per repo
// toplevel.
import { acceptHMRUpdate } from 'pinia';
import {
  initialState,
  serialize,
  deserialize,
  reconcile as reconcileState,
  createList as createListState,
  deleteList as deleteListState,
  renameList as renameListState,
  setActive as setActiveState,
  moveFile as moveFileState,
  type ChangelistState
} from '~/utils/changelist';

// How long to coalesce rapid edits before writing the file.
const SAVE_DEBOUNCE_MS = 300;

// Session-only bookkeeping (deliberately not in store state, so none of it is
// persisted): the in-flight first-load promise per repo (dedups concurrent
// loads), pending debounce timers, the set of repos with unsaved local edits
// (so an external re-read never clobbers them), and the last JSON we read/wrote
// per repo (so a reconcile that changes nothing writes nothing — which also
// stops our own write from looping back through the FS watcher), and the write
// currently in flight. All are keyed by repo toplevel and emptied by `release`
// when a tab closes; nothing else removes an entry, so a repo that skips that
// call is resident for the rest of the session.
const loading = new Map<string, Promise<void>>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const dirty = new Set<string>();
const lastWritten = new Map<string, string>();
// The write currently in flight per repo. It does two jobs, both of which the
// close-during-read guards on `load`/`reload`/`sync` do not reach. First, it is
// the liveness marker `persistNow` compares against after its await: a write
// that resolves for a repo already released must not re-create `lastWritten`,
// which is the costliest entry and would then never be removed again. Compared
// by IDENTITY, so a close-then-reopen lets the newer write win. Second, holding
// it lets a release's flush queue behind a write already in flight, instead of
// racing it and letting the older payload land last.
const writing = new Map<string, Promise<void>>();

const real = (toplevel: string) => !!toplevel && toplevel !== '.';

export const useChangelistsStore = defineStore('changelists', {
  state: () => ({
    byRepo: {} as Record<string, ChangelistState>
  }),
  getters: {
    // The changelist state for a repo toplevel (a default-only state until its
    // first reconcile populates it). Reactive: depends on `byRepo[toplevel]`.
    forRepo(): (toplevel: string) => ChangelistState {
      return (toplevel) => this.byRepo[toplevel] ?? initialState();
    }
  },
  actions: {
    ensure(toplevel: string): ChangelistState {
      if (!this.byRepo[toplevel]) this.byRepo[toplevel] = initialState();
      return this.byRepo[toplevel]!;
    },

    // Load a repo's membership from the git-native store, once per session
    // (concurrent callers share the one in-flight promise). The file wins when
    // present; otherwise any cached (localStorage / browser) membership is
    // migrated into the file so the first desktop run seeds it.
    load(toplevel: string): Promise<void> {
      if (!real(toplevel)) return Promise.resolve();
      const inFlight = loading.get(toplevel);
      if (inFlight) return inFlight;
      // Declared up front so the body can compare against its own registration
      // (a `const` may not reference itself from inside its initializer).
      let run: Promise<void> | undefined;
      run = (async () => {
        const fromDisk = deserialize(await gitClient.readChangelists(toplevel));
        // Our own registration is gone, so `release` ran while the read was in
        // flight (the tab closed). Landing the result now would put back the
        // entries release just dropped, and nothing would ever drop them again.
        if (loading.get(toplevel) !== run) return;
        if (fromDisk) {
          lastWritten.set(toplevel, serialize(fromDisk));
          this.byRepo[toplevel] = fromDisk;
        } else if (this.byRepo[toplevel]) {
          await this.persistNow(toplevel);
        }
      })();
      loading.set(toplevel, run);
      return run;
    },

    // Re-read the file from disk (e.g. on switching to / re-opening a repo), to
    // pick up edits made by an external tool. Skipped while local edits are
    // still pending so it can't clobber them. Registers itself as the load
    // dedup synchronously, so a `sync` firing in the same tick awaits this read
    // rather than starting a second one.
    reload(toplevel: string): Promise<void> {
      if (!real(toplevel) || dirty.has(toplevel)) return Promise.resolve();
      let run: Promise<void> | undefined;
      run = (async () => {
        const fromDisk = deserialize(await gitClient.readChangelists(toplevel));
        // Same close-during-read guard as `load` above.
        if (loading.get(toplevel) !== run) return;
        if (fromDisk) {
          lastWritten.set(toplevel, serialize(fromDisk));
          this.byRepo[toplevel] = fromDisk;
        }
      })();
      loading.set(toplevel, run);
      return run;
    },

    // Reconcile membership with the real working tree (new changes → active
    // list, vanished changes pruned), after ensuring the file is loaded first so
    // a slow read can't be overwritten by an early reconcile. The panel calls
    // this whenever the status changes.
    async sync(toplevel: string, changedPaths: string[]) {
      if (!real(toplevel)) return;
      await this.load(toplevel);
      // The tab closed while the load was in flight. `loading` doubles as the
      // liveness marker — `load` registers it and only `release` removes it —
      // so bail rather than let `ensure` below re-create the released state.
      if (!loading.has(toplevel)) return;
      this.byRepo[toplevel] = reconcileState(
        this.ensure(toplevel),
        changedPaths
      );
      this.schedulePersist(toplevel);
    },

    // Persist now (awaitable): write the file, then remember what we wrote so a
    // watcher-triggered re-read sees "no change".
    async persistNow(toplevel: string) {
      if (!real(toplevel)) return;
      const json = serialize(this.forRepo(toplevel));
      const write = gitClient
        .writeChangelists({ path: toplevel, json })
        .then(() => {});
      writing.set(toplevel, write);
      await write;
      // The tab may have closed while that write was in flight. `release` drops
      // the entry, so a write that is no longer the registered one belongs to a
      // repo that has been let go (or superseded by a newer one) and must not
      // write its bookkeeping back.
      if (writing.get(toplevel) !== write) return;
      writing.delete(toplevel);
      lastWritten.set(toplevel, json);
      dirty.delete(toplevel);
    },

    // Persist after a short debounce, unless the serialized state is identical to
    // what is already on disk (no real change → no write → no FS-watcher churn).
    schedulePersist(toplevel: string) {
      if (!real(toplevel)) return;
      if (serialize(this.forRepo(toplevel)) === lastWritten.get(toplevel))
        return;
      dirty.add(toplevel);
      const prev = saveTimers.get(toplevel);
      if (prev) clearTimeout(prev);
      saveTimers.set(
        toplevel,
        setTimeout(() => {
          saveTimers.delete(toplevel);
          void this.persistNow(toplevel);
        }, SAVE_DEBOUNCE_MS)
      );
    },

    // Drop every trace of a repo, called when its tab closes. Without this each
    // of the four session maps kept an entry for every repo the session had
    // ever touched — `lastWritten` worst of all, since it holds the full
    // serialized JSON per repo — and `byRepo` kept its entry in localStorage
    // across restarts as well.
    //
    // `byRepo` is pruned deliberately, not merely allowed to go: the file in
    // the git dir is the source of truth and is re-read on the next open, and
    // the flush below means even the last unsaved edit is in it by then, so the
    // cache has nothing left to say. Keeping it would leave the persisted half
    // of the leak in place, which is the half that survives a restart.
    //
    // A pending debounced write is FLUSHED, not cancelled: membership is the
    // user's intent, not a derived cache, so dropping the timer would silently
    // lose the last edit whenever a tab is closed inside the debounce window.
    // The write is issued here rather than through `persistNow` because
    // `persistNow` re-populates `lastWritten` after its await, which would
    // resurrect the entry this action exists to remove.
    async release(toplevel: string) {
      const timer = saveTimers.get(toplevel);
      if (timer) clearTimeout(timer);
      saveTimers.delete(toplevel);
      // Serialize before the state goes; `dirty` is exactly "edits the file has
      // not seen yet".
      const pending =
        real(toplevel) && dirty.has(toplevel)
          ? serialize(this.forRepo(toplevel))
          : null;
      loading.delete(toplevel);
      dirty.delete(toplevel);
      lastWritten.delete(toplevel);
      // Taking the entry invalidates any write still in flight, so it cannot
      // write its bookkeeping back once it lands.
      const inFlight = writing.get(toplevel);
      writing.delete(toplevel);
      delete this.byRepo[toplevel];
      if (!pending) return;
      // Queue behind that write rather than racing it: an edit made after the
      // debounce fired is newer than the payload already on its way, and
      // nothing orders two IPC calls, so the older one could otherwise land
      // last and lose the newest edit.
      if (inFlight) await inFlight.catch(() => {});
      await gitClient.writeChangelists({ path: toplevel, json: pending });
    },

    createList(toplevel: string, name: string): string {
      const { state, id } = createListState(this.ensure(toplevel), name);
      this.byRepo[toplevel] = state;
      this.schedulePersist(toplevel);
      return id;
    },
    deleteList(toplevel: string, id: string) {
      this.byRepo[toplevel] = deleteListState(this.ensure(toplevel), id);
      this.schedulePersist(toplevel);
    },
    renameList(toplevel: string, id: string, name: string) {
      this.byRepo[toplevel] = renameListState(this.ensure(toplevel), id, name);
      this.schedulePersist(toplevel);
    },
    setActive(toplevel: string, id: string) {
      this.byRepo[toplevel] = setActiveState(this.ensure(toplevel), id);
      this.schedulePersist(toplevel);
    },
    moveFile(toplevel: string, file: string, toId: string) {
      this.byRepo[toplevel] = moveFileState(this.ensure(toplevel), file, toId);
      this.schedulePersist(toplevel);
    },
    // Move every file out of `fromId` into `toId` in one update (the "move all"
    // header action).
    moveAll(toplevel: string, fromId: string, toId: string) {
      const from = this.ensure(toplevel).lists.find((l) => l.id === fromId);
      if (!from) return;
      let next = this.byRepo[toplevel]!;
      for (const file of from.members) next = moveFileState(next, file, toId);
      this.byRepo[toplevel] = next;
      this.schedulePersist(toplevel);
    }
  },
  persist: true
});

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useChangelistsStore, import.meta.hot));
}
