// Per-repo changelist membership (which changed file is in which named group),
// persisted across restarts. The grouping is soft, client-side state layered
// over the real working tree — git never sees it; committing a list stages
// exactly its files via the backend `commit_paths`. Thin wrappers over the pure
// model in `~/utils/changelist`; one entry per repo toplevel.
import { acceptHMRUpdate } from 'pinia';
import {
  initialState,
  reconcile as reconcileState,
  createList as createListState,
  deleteList as deleteListState,
  renameList as renameListState,
  setActive as setActiveState,
  moveFile as moveFileState,
  type ChangelistState
} from '~/utils/changelist';

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
    reconcile(toplevel: string, changedPaths: string[]) {
      this.byRepo[toplevel] = reconcileState(
        this.ensure(toplevel),
        changedPaths
      );
    },
    createList(toplevel: string, name: string): string {
      const { state, id } = createListState(this.ensure(toplevel), name);
      this.byRepo[toplevel] = state;
      return id;
    },
    deleteList(toplevel: string, id: string) {
      this.byRepo[toplevel] = deleteListState(this.ensure(toplevel), id);
    },
    renameList(toplevel: string, id: string, name: string) {
      this.byRepo[toplevel] = renameListState(this.ensure(toplevel), id, name);
    },
    setActive(toplevel: string, id: string) {
      this.byRepo[toplevel] = setActiveState(this.ensure(toplevel), id);
    },
    moveFile(toplevel: string, file: string, toId: string) {
      this.byRepo[toplevel] = moveFileState(this.ensure(toplevel), file, toId);
    }
  },
  persist: true
});

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useChangelistsStore, import.meta.hot));
}
