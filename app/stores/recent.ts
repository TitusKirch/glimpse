// Recently opened repositories, persisted across restarts so the start screen
// and command palette can offer one-click reopen. Kept separate from the repo
// store (which holds live, non-persisted git state).

import { acceptHMRUpdate } from 'pinia';

export interface RecentRepo {
  path: string;
  name: string;
}

export const useRecentStore = defineStore('recent', {
  state: () => ({
    repos: [] as RecentRepo[]
  }),
  actions: {
    // Move/insert `path` to the front (most-recent-first), de-duplicated, then
    // trim to the user-configured maximum (Settings → General → Recent). The
    // move-to-front/dedup/trim mechanics live in the shared `moveToFront` core.
    push({ path, name }: { path: string; name: string }) {
      this.repos = moveToFront({
        list: this.repos,
        item: { path, name },
        key: (r) => r.path,
        max: useLayoutStore().recentReposMax
      });
    },
    remove(path: string) {
      this.repos = this.repos.filter((r) => r.path !== path);
    },
    clear() {
      this.repos = [];
    }
  },
  persist: true
});

// Clean HMR so editing this store doesn't desync the dev client.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRecentStore, import.meta.hot));
}
