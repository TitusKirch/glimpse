// Recently-used actions, persisted across restarts so surfaces (currently just
// the command palette) can offer a most-recently-used list. Deliberately generic
// — an action is just a stable string id plus a timestamp — so other surfaces
// can feed it later. Today only palette-initiated actions are recorded.

import { acceptHMRUpdate } from 'pinia';

export interface RecentAction {
  id: string;
  // Epoch ms of the last use; entries are ordered most-recent-first.
  at: number;
}

export const useRecentActionsStore = defineStore('recentActions', {
  state: () => ({
    actions: [] as RecentAction[]
  }),
  actions: {
    // Record a use of `id`: drop any existing entry (no duplicates), prepend it
    // with a fresh timestamp so it bubbles to the top, then trim to the
    // configured maximum (Settings → General → Recent). Shares the
    // move-to-front/dedup/trim core with the recent-repos list; the cap lives on
    // the settings store.
    record(id: string) {
      this.actions = moveToFront({
        list: this.actions,
        item: { id, at: Date.now() },
        key: (a) => a.id,
        max: useSettingsStore().recentActionsMax
      });
    },
    remove(id: string) {
      this.actions = this.actions.filter((a) => a.id !== id);
    },
    clear() {
      this.actions = [];
    }
  },
  persist: true
});

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useRecentActionsStore, import.meta.hot)
  );
}
