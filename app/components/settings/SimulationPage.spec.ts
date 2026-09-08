// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, defineStore, setActivePinia } from 'pinia';

// The page reads both through Nuxt auto-imports (free globals); expose them
// before importing the store module and the component.
const g = globalThis as Record<string, unknown>;
g.defineStore = defineStore;
const { useSimulationStore } = await import('@/stores/simulation');
g.useSimulationStore = useSimulationStore;
// Only `settings.simulation.flags.*` is deliberately absent — no switch exists
// yet — so `te` answers for that prefix the way vue-i18n would.
g.useI18n = () => ({
  t: (key: string) => key,
  te: (key: string) => !key.startsWith('settings.simulation.flags.')
});

const SimulationPage = (await import('./SimulationPage.vue')).default;

const global = {
  stubs: {
    NuxtIcon: { template: '<i />' },
    UiBadge: { template: '<span class="badge"><slot /></span>' },
    UiButton: {
      props: ['disabled'],
      template:
        '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
    }
  }
};

beforeEach(() => setActivePinia(createPinia()));

describe('SimulationPage', () => {
  it('says nothing is bent when no simulation is on', () => {
    const w = mount(SimulationPage, { global });
    expect(w.text()).toContain('settings.simulation.none');
    expect(w.findAll('.badge')).toHaveLength(0);
  });

  it('lists every active simulation', async () => {
    const sim = useSimulationStore();
    sim.set('ipcFailure', true);
    sim.set('updateAvailable', true);
    const w = mount(SimulationPage, { global });
    await w.vm.$nextTick();
    expect(w.findAll('.badge').map((b) => b.text())).toEqual([
      'ipcFailure',
      'updateAvailable'
    ]);
    expect(w.text()).not.toContain('settings.simulation.none');
  });

  it('turns everything off from one control', async () => {
    const sim = useSimulationStore();
    sim.set('ipcFailure', true);
    const w = mount(SimulationPage, { global });
    await w.get('button').trigger('click');
    expect(sim.anyActive).toBe(false);
  });

  it('offers nothing to turn off when nothing is on', () => {
    const w = mount(SimulationPage, { global });
    expect(w.get('button').attributes('disabled')).toBeDefined();
  });
});
