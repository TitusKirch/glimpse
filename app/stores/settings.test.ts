// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, defineStore, setActivePinia } from 'pinia';

// The store uses `defineStore` as a Nuxt auto-import (a free global); expose it
// before importing the module (which calls it at evaluation time).
(globalThis as Record<string, unknown>).defineStore = defineStore;
const { useSettingsStore } = await import('./settings');

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
});

describe('settings store get() / EFFECTIVE', () => {
  it('returns raw values by default', () => {
    const s = useSettingsStore();
    expect(s.get('releaseChannel')).toBe('stable');
    expect(s.get('diffMode')).toBe('split');
  });

  it('falls back the Experiment channel to Beta unless the gates are open', () => {
    const s = useSettingsStore();
    s.releaseChannel = 'experiment';
    expect(s.get('releaseChannel')).toBe('beta');
    s.devMode = true;
    s.experimentsEnabled = true;
    expect(s.get('releaseChannel')).toBe('experiment');
    expect(s.get('experimentsEnabled')).toBe(true);
  });

  it('gates experimentsEnabled behind developer mode', () => {
    const s = useSettingsStore();
    s.experimentsEnabled = true;
    s.devMode = false;
    expect(s.get('experimentsEnabled')).toBe(false);
  });
});

describe('settings store actions', () => {
  it('initSearchLocales defaults by UI locale, once', () => {
    const s = useSettingsStore();
    s.initSearchLocales('en-US');
    expect(s.searchLocales).toEqual([]);
    // already initialised → a later call is a no-op
    s.initSearchLocales('de-DE');
    expect(s.searchLocales).toEqual([]);

    const s2 = useSettingsStore();
    s2.searchLocales = null;
    s2.initSearchLocales('de-DE');
    expect(s2.searchLocales).toEqual(['en-GB']);
  });

  it('has simple setters and toggles', () => {
    const s = useSettingsStore();
    s.setSearchLocales(['fr-FR']);
    expect(s.searchLocales).toEqual(['fr-FR']);
    s.setDiffMode('unified');
    expect(s.diffMode).toBe('unified');
    const w = s.diffWrap;
    s.toggleDiffWrap();
    expect(s.diffWrap).toBe(!w);
    s.setFileView('list');
    expect(s.fileView).toBe('list');
    s.toggleFileView();
    expect(s.fileView).toBe('tree');
    s.toggleFileView();
    expect(s.fileView).toBe('list');
  });

  it('normalizeNumbers clamps to range, rounds, and respects sibling maxes', () => {
    const s = useSettingsStore();
    s.sidebarWidth = 99999;
    s.recentReposMax = 0;
    s.autoFetchMinutes = 'oops' as unknown as number;
    s.normalizeNumbers();
    expect(s.sidebarWidth).toBe(512);
    expect(s.recentReposMax).toBe(1);
    expect(s.autoFetchMinutes).toBe(1); // non-number → lower bound

    s.recentReposMax = 5;
    s.recentReposOnPage = 10; // above its sibling max
    s.normalizeNumbers();
    expect(s.recentReposOnPage).toBe(5);
  });

  it('normalizeChannel drops an inaccessible Experiment selection and reports change', () => {
    const s = useSettingsStore();
    s.releaseChannel = 'experiment';
    expect(s.normalizeChannel()).toBe(true);
    expect(s.releaseChannel).toBe('beta');
    // already consistent → no change
    expect(s.normalizeChannel()).toBe(false);
  });

  it('migrate copies real settings out of the old layout blob, once', () => {
    localStorage.setItem(
      'layout',
      JSON.stringify({ diffMode: 'unified', autoFetch: true, monoScale: 2 })
    );
    const s = useSettingsStore();
    s.migrate();
    expect(s.diffMode).toBe('unified');
    expect(s.autoFetch).toBe(true);
    expect(s.monoScale).toBe(2);
  });

  it('migrate is a no-op when this store was already persisted', () => {
    localStorage.setItem('settings', '{}');
    localStorage.setItem('layout', JSON.stringify({ diffMode: 'unified' }));
    const s = useSettingsStore();
    s.migrate();
    expect(s.diffMode).toBe('split');
  });

  it('migrate tolerates a corrupt layout blob', () => {
    localStorage.setItem('layout', 'not json');
    const s = useSettingsStore();
    expect(() => s.migrate()).not.toThrow();
    expect(s.diffMode).toBe('split');
  });
});
