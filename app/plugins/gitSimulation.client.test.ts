// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick, watch } from 'vue';

// The plugin reads `defineNuxtPlugin`, `watch`, the simulation store, the git
// fault ids and `gitClient` as Nuxt auto-imports (free globals); provide them so
// the module body runs headless. The store and the ids are the *real* ones —
// they are half of what is under test.
const g = globalThis as Record<string, unknown>;
g.defineNuxtPlugin = (setup: unknown) => setup;
g.defineStore = defineStore;
g.watch = watch;

const { useSimulationStore } = await import('@/stores/simulation');
g.useSimulationStore = useSimulationStore;
const { GIT_FAULTS, SIM_GIT_FAILURE, SIM_GIT_SLOW } =
  await import('@/utils/simulations');
Object.assign(g, { GIT_FAULTS, SIM_GIT_FAILURE, SIM_GIT_SLOW });

const sent: { fail: boolean; slow: boolean }[] = [];
g.gitClient = {
  setGitSimulation: async (a: { fail: boolean; slow: boolean }) =>
    void sent.push(a)
};

const plugin = (await import('./gitSimulation.client')).default as () => void;

beforeEach(() => {
  setActivePinia(createPinia());
  sent.length = 0;
});

describe('the git simulation plugin', () => {
  it('re-asserts the store at boot', async () => {
    // The store is session-only but the Rust process outlives a webview reload,
    // so after F5 the store is empty while the backend could still be failing
    // every git call — and nothing would ever change to flip it back. Pushing
    // once at startup makes the frontend authoritative.
    plugin();
    expect(sent).toEqual([{ fail: false, slow: false }]);
  });

  it('follows each switch as it is flipped', async () => {
    const sim = useSimulationStore();
    plugin();
    sim.set(SIM_GIT_FAILURE, true);
    await nextTick();
    expect(sent.at(-1)).toEqual({ fail: true, slow: false });
    sim.set(SIM_GIT_SLOW, true);
    await nextTick();
    expect(sent.at(-1)).toEqual({ fail: true, slow: true });
  });

  it('carries "turn everything off" through to the backend', async () => {
    const sim = useSimulationStore();
    sim.set(SIM_GIT_FAILURE, true);
    sim.set(SIM_GIT_SLOW, true);
    plugin();
    sim.disableAll();
    await nextTick();
    expect(sent.at(-1)).toEqual({ fail: false, slow: false });
  });

  it('says nothing when an unrelated simulation is flipped', async () => {
    const sim = useSimulationStore();
    plugin();
    const before = sent.length;
    sim.set('somethingElse', true);
    await nextTick();
    expect(sent).toHaveLength(before);
  });
});
