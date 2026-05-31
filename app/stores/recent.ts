// Recently opened repositories, persisted across restarts so the start screen
// and command palette can offer one-click reopen. Kept separate from the repo
// store (which holds live, non-persisted git state).

export interface RecentRepo {
  path: string;
  name: string;
}

const MAX_RECENT = 10;

export const useRecentStore = defineStore('recent', {
  state: () => ({
    repos: [] as RecentRepo[]
  }),
  actions: {
    // Move/insert `path` to the front (most-recent-first), de-duplicated.
    push(path: string, name: string) {
      this.repos = [
        { path, name },
        ...this.repos.filter((r) => r.path !== path)
      ].slice(0, MAX_RECENT);
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
