import { describe, expect, it } from 'vitest';
import { DEVELOPER_PAGES, isDeveloperPage } from './developerPages';

describe('the Developer settings group', () => {
  it('offers four pages, ordered by what a tool does to the app', () => {
    expect(DEVELOPER_PAGES.map((p) => p.key)).toEqual([
      'showcase',
      'triggers',
      'diagnostics',
      'simulation'
    ]);
  });

  it('gives every page a nav icon', () => {
    for (const page of DEVELOPER_PAGES) expect(page.icon).toMatch(/^lucide:/);
  });
});

describe('isDeveloperPage', () => {
  it('recognises every page the group unlocks', () => {
    for (const page of DEVELOPER_PAGES)
      expect(isDeveloperPage(page.key)).toBe(true);
  });

  it('rejects a page that is not behind dev mode', () => {
    expect(isDeveloperPage('general')).toBe(false);
    expect(isDeveloperPage('appearance')).toBe(false);
    expect(isDeveloperPage('about')).toBe(false);
  });
});
