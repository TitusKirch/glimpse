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
// stops our own write from looping back through the FS watcher).
const loading = new Map<string, Promise<void>>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const dirty = new Set<string>();
const lastWritten = new Map<string, string>();

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
      let p = loading.get(toplevel);
      if (!p) {
        p = (async () => {
          const fromDisk = deserialize(
            await gitClient.readChangelists(toplevel)
          );
          if (fromDisk) {
            lastWritten.set(toplevel, serialize(fromDisk));
            this.byRepo[toplevel] = fromDisk;
          } else if (this.byRepo[toplevel]) {
            await this.persistNow(toplevel);
          }
        })();
        loading.set(toplevel, p);
      }
      return p;
    },

    // Re-read the file from disk (e.g. on switching to / re-opening a repo), to
    // pick up edits made by an external tool. Skipped while local edits are
    // still pending so it can't clobber them. Registers itself as the load
    // dedup synchronously, so a `sync` firing in the same tick awaits this read
    // rather than starting a second one.
    reload(toplevel: string): Promise<void> {
      if (!real(toplevel) || dirty.has(toplevel)) return Promise.resolve();
      const p = (async () => {
        const fromDisk = deserialize(await gitClient.readChangelists(toplevel));
        if (fromDisk) {
          lastWritten.set(toplevel, serialize(fromDisk));
          this.byRepo[toplevel] = fromDisk;
        }
      })();
      loading.set(toplevel, p);
      return p;
    },

    // Reconcile membership with the real working tree (new changes → active
    // list, vanished changes pruned), after ensuring the file is loaded first so
    // a slow read can't be overwritten by an early reconcile. The panel calls
    // this whenever the status changes.
    async sync(toplevel: string, changedPaths: string[]) {
      if (!real(toplevel)) return;
      await this.load(toplevel);
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
      await gitClient.writeChangelists({ path: toplevel, json });
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
    }
  },
  persist: true
});

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useChangelistsStore, import.meta.hot));
}
