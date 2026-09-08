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
const {
  GIT_FAULTS,
  SIMULATION_GROUPS,
  SIM_GIT_FAILURE,
  SIM_GIT_SLOW,
  SIM_UPDATE_AVAILABLE,
  UPDATER_SIMULATIONS
} = await import('@/utils/simulations');
Object.assign(g, {
  GIT_FAULTS,
  SIMULATION_GROUPS,
  SIM_GIT_FAILURE,
  SIM_GIT_SLOW,
  SIM_UPDATE_AVAILABLE,
  UPDATER_SIMULATIONS
});
/** Every registered switch, in page order. */
const ALL_IDS = SIMULATION_GROUPS.flatMap((group) => [...group.ids]);
// A switch's own change owns its label key, so `te` answers for exactly the
// ids that ship one — an id registered without a translation still has to fall
// back to showing itself.
const translated = new Set(
  ALL_IDS.map((id) => `settings.simulation.flags.${id}`)
);
g.useI18n = () => ({
  t: (key: string) => key,
  te: (key: string) =>
    !key.startsWith('settings.simulation.flags.') || translated.has(key)
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
    },
    SettingsRow: {
      props: ['label', 'hint'],
      template: '<div class="row"><span>{{ label }}</span><slot /></div>'
    },
    UiSwitch: {
      props: ['modelValue'],
      template:
        '<button class="switch" :aria-checked="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />'
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
    // Both ids are deliberately unregistered ones: the badge has to name a
    // simulation it has no translation for rather than render a key path.
    sim.set('ipcFailure', true);
    sim.set('somethingElse', true);
    const w = mount(SimulationPage, { global });
    await w.vm.$nextTick();
    expect(w.findAll('.badge').map((b) => b.text())).toEqual([
      'ipcFailure',
      'somethingElse'
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

  it('offers one switch per registered simulation, off to begin with', () => {
    const w = mount(SimulationPage, { global });
    const switches = w.findAll('.switch');
    expect(switches).toHaveLength(ALL_IDS.length);
    for (const s of switches)
      expect(s.attributes('aria-checked')).toBe('false');
    // Each row is named by its own key, not by the raw id.
    for (const id of ALL_IDS)
      expect(w.text()).toContain(`settings.simulation.flags.${id}`);
  });

  it('sections the switches by the mechanism each group bends', () => {
    // What a switch can and cannot reach is the thing to know before flipping
    // it, so the page says which is which rather than listing them all flat.
    const w = mount(SimulationPage, { global });
    for (const group of SIMULATION_GROUPS)
      expect(w.text()).toContain(
        `settings.simulation.groups.${group.key}.label`
      );
  });

  it('reaches the updater switches from the one control too', async () => {
    const sim = useSimulationStore();
    sim.set(SIM_UPDATE_AVAILABLE, true);
    const w = mount(SimulationPage, { global });
    const updaterSwitch = w.findAll('.switch')[GIT_FAULTS.length]!;
    expect(updaterSwitch.attributes('aria-checked')).toBe('true');
    await w.get('button').trigger('click');
    expect(sim.isOn(SIM_UPDATE_AVAILABLE)).toBe(false);
    expect(UPDATER_SIMULATIONS).toContain(SIM_UPDATE_AVAILABLE);
  });

  it('registers the fault in the store when its switch goes on', async () => {
    const sim = useSimulationStore();
    const w = mount(SimulationPage, { global });
    await w.findAll('.switch')[0]!.trigger('click');
    expect(sim.isOn(SIM_GIT_FAILURE)).toBe(true);
    // And it shows up in the active list, under its translated name — the whole
    // point of the badge is that a bent app says so in words.
    expect(w.findAll('.badge').map((b) => b.text())).toEqual([
      `settings.simulation.flags.${SIM_GIT_FAILURE}`
    ]);
    await w.findAll('.switch')[0]!.trigger('click');
    expect(sim.isOn(SIM_GIT_FAILURE)).toBe(false);
  });

  it('turns its own switches back off from the one control', async () => {
    const sim = useSimulationStore();
    sim.set(SIM_GIT_SLOW, true);
    const w = mount(SimulationPage, { global });
    expect(w.findAll('.switch')[1]!.attributes('aria-checked')).toBe('true');
    await w.get('button').trigger('click');
    expect(w.findAll('.switch')[1]!.attributes('aria-checked')).toBe('false');
  });
});
