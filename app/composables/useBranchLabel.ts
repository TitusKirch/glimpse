// Shared branch/ref label shortening, used by the commit graph and the sidebar
// so a long bot branch reads the same everywhere. The full name still lives in
// the row's tooltip — this only trims what's rendered inline.
export function useBranchLabel() {
  const settings = useSettingsStore();

  // Compact a long bot branch when the pref is on — guarded to `dependabot/`
  // refs so normal hyphenated branches (feat/my-thing) are left alone. Collapses
  // the noisy middle AND ellipsises the trailing version/hash (everything from
  // the last '-'), keeping a `-…` marker: origin/dependabot/npm_and_yarn/pkg-action-1.2.3
  // -> origin/dependabot/…/pkg-action-…
  function shortenBranch(name: string): string {
    if (settings.shortenDependabot && /dependabot\//.test(name)) {
      return name
        .replace(/(dependabot)\/.+\/([^/]+)$/, '$1/…/$2')
        .replace(/-[^/-]*$/, '-…');
    }
    return name;
  }

  // Graph refs arrive prefixed (`HEAD -> main`, `tag: v1`); strip those.
  function fullRefLabel(ref: string): string {
    return ref.replace('HEAD -> ', '').replace('tag: ', '');
  }
  // The shortened, display version of a graph ref.
  function refLabel(ref: string): string {
    return shortenBranch(fullRefLabel(ref));
  }

  return { shortenBranch, refLabel, fullRefLabel };
}
