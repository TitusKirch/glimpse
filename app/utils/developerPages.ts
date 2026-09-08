// The Developer group in the settings dialog: the pages dev mode unlocks, in
// nav order. The group is ordered along one axis — what a tool does to the app:
// Showcase shows building blocks, Triggers fires one-off actions, Diagnostics
// only observes the running app, and Simulation bends its runtime behaviour.
// That split is why a read-only log never sits next to a switch that makes every
// git call fail.
//
// One source of truth: the dialog builds its nav from this list *and* asks
// `isDeveloperPage` whether the open page has to be left when dev mode goes off,
// so a page added here can't be forgotten in the second place.

export const DEVELOPER_PAGES = [
  { key: 'showcase', icon: 'lucide:layout-grid' },
  { key: 'triggers', icon: 'lucide:zap' },
  { key: 'diagnostics', icon: 'lucide:activity' },
  { key: 'simulation', icon: 'lucide:flask-round' }
] as const;

export type DeveloperPageKey = (typeof DEVELOPER_PAGES)[number]['key'];

/** Is this settings page one of the ones dev mode unlocks? */
export function isDeveloperPage(key: string): key is DeveloperPageKey {
  return DEVELOPER_PAGES.some((p) => p.key === key);
}
