// Active simulations: the developer switches that deliberately bend the running
// app (make IPC fail, pretend an update is available, …). Deliberately NOT
// persisted — unlike every other store here, this one is session-only and lives
// only in memory, so every app start is clean. A switch that makes git calls
// fail can therefore never greet someone after a restart, and a forgotten switch
// can never be reported as a real bug. The cost is accepted: a test spanning a
// restart cannot be driven from the Simulation page.
//
// The store is a registry rather than a fixed set of fields: the tools that flip
// these switches land in their own changes and register their own id, so nothing
// here has to be touched to add one. The Simulation page and the sidebar badge
// read `active` / `anyActive`, so both surfaces stay right without knowing which
// simulations exist.

import { acceptHMRUpdate } from 'pinia';

// One switch's id, e.g. 'ipcFailure'. A free string while the switches
// themselves are still arriving; each tool owns the constant it registers.
export type SimulationId = string;

export const useSimulationStore = defineStore('simulation', {
  state: () => ({
    // Only the switches that are ON are kept, so `active` is the key set.
    on: {} as Record<SimulationId, true>
  }),
  getters: {
    /** The ids currently bending the app, in the order they were switched on. */
    active: (s): SimulationId[] => Object.keys(s.on),
    /** Is anything bent right now? Drives the app-wide sidebar badge. */
    anyActive: (s): boolean => Object.keys(s.on).length > 0,
    /** Is this one switch on? */
    isOn: (s) => (id: SimulationId) => s.on[id] === true
  },
  actions: {
    set(id: SimulationId, on: boolean) {
      if (on) this.on[id] = true;
      else delete this.on[id];
    },
    /** The single "turn everything off" — one click back to an unbent app. */
    disableAll() {
      this.on = {};
    }
  }
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSimulationStore, import.meta.hot));
}
