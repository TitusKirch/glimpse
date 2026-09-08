// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { createPersistedState } from 'pinia-plugin-persistedstate';

// The store uses `defineStore` as a Nuxt auto-import (a free global); expose it
// before importing the module (which calls it at evaluation time).
(globalThis as Record<string, unknown>).defineStore = defineStore;
const { useSimulationStore } = await import('./simulation');

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
});

describe('simulation store', () => {
  it('starts a session with nothing bent', () => {
    const sim = useSimulationStore();
    expect(sim.active).toEqual([]);
    expect(sim.anyActive).toBe(false);
    expect(sim.isOn('ipcFailure')).toBe(false);
  });

  it('reports a switched-on simulation as active', () => {
    const sim = useSimulationStore();
    sim.set('ipcFailure', true);
    expect(sim.isOn('ipcFailure')).toBe(true);
    expect(sim.active).toEqual(['ipcFailure']);
    expect(sim.anyActive).toBe(true);
  });

  it('switching one back off drops it from the active list', () => {
    const sim = useSimulationStore();
    sim.set('ipcFailure', true);
    sim.set('updateAvailable', true);
    sim.set('ipcFailure', false);
    expect(sim.active).toEqual(['updateAvailable']);
    expect(sim.anyActive).toBe(true);
  });

  it('turns everything off in one go', () => {
    const sim = useSimulationStore();
    sim.set('ipcFailure', true);
    sim.set('updateAvailable', true);
    sim.set('i18nKeys', true);
    expect(sim.active).toHaveLength(3);

    sim.disableAll();
    expect(sim.active).toEqual([]);
    expect(sim.anyActive).toBe(false);
    expect(sim.isOn('ipcFailure')).toBe(false);
  });
});

// The app installs pinia-plugin-persistedstate globally, so "session-only" is a
// claim about *this* store opting out — not about the plugin being absent. Drive
// the real plugin, wired the way the app wires it (installed on a Vue app, which
// is what makes pinia run its plugins at all), so the assertion below fails the
// moment someone adds `persist` to the store.
function restart() {
  const pinia = createPinia();
  pinia.use(createPersistedState());
  createApp({ template: '<i />' }).use(pinia);
  setActivePinia(pinia);
}

describe('simulation state is session-only', () => {
  beforeEach(() => {
    localStorage.clear();
    restart();
  });

  it('writes nothing to storage and starts the next session clean', async () => {
    const sim = useSimulationStore();
    sim.set('ipcFailure', true);
    await nextTick();
    expect(sim.anyActive).toBe(true);
    expect(localStorage.getItem('simulation')).toBeNull();

    restart();
    expect(useSimulationStore().anyActive).toBe(false);
  });
});
