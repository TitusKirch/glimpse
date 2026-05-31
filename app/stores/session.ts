// Persisted session: which repository paths are open and which is active, so
// the tabs can be reopened on the next launch. Kept separate from the repo
// store (which holds live, non-persisted git state). `initialized` distinguishes
// a first-ever launch (open the CWD) from "the user closed every tab" (start
// screen) — both leave `openPaths` empty.

import { acceptHMRUpdate } from 'pinia';

export const useSessionStore = defineStore('session', {
  state: () => ({
    initialized: false,
    openPaths: [] as string[],
    activePath: ''
  }),
  persist: true
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSessionStore, import.meta.hot));
}
