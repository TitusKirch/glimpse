// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { moveToFront } from '../utils/recency';

// The recency stores reference these as Nuxt auto-imports (free globals); expose
// them before importing the store modules, which call them at action time. The
// cap is read from the settings store on purpose — reading it from the wrong
// store used to pass `undefined`, collapsing every write to `[]` (#87).
const g = globalThis as Record<string, unknown>;
g.defineStore = defineStore;
g.moveToFront = moveToFront;
const { useSettingsStore } = await import('./settings');
g.useSettingsStore = useSettingsStore;
const { useRecentStore } = await import('./recent');
const { useRecentActionsStore } = await import('./recentActions');

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
});

describe('recent repos store (regression for #87)', () => {
  it('keeps pushed repos instead of silently wiping them', () => {
    const recent = useRecentStore();
    recent.push({ path: '/a', name: 'a' });
    expect(recent.repos).toHaveLength(1);
  });

  it('caps the list at the settings-store max, newest first', () => {
    useSettingsStore().recentReposMax = 3;
    const recent = useRecentStore();
    for (const n of ['a', 'b', 'c', 'd', 'e'])
      recent.push({ path: `/${n}`, name: n });
    expect(recent.repos.map((r) => r.name)).toEqual(['e', 'd', 'c']);
  });
});

describe('recent actions store (regression for #87)', () => {
  it('records actions instead of silently wiping them', () => {
    const actions = useRecentActionsStore();
    actions.record('open-repo');
    expect(actions.actions).toHaveLength(1);
  });

  it('caps the list at the settings-store max, newest first', () => {
    useSettingsStore().recentActionsMax = 2;
    const actions = useRecentActionsStore();
    for (const id of ['a', 'b', 'c']) actions.record(id);
    expect(actions.actions.map((a) => a.id)).toEqual(['c', 'b']);
  });
});
