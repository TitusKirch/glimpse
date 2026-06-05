// The per-repo git override policy in one place: the set of local keys an
// override owns, the flag that records "this repo is customised", and the
// effective scope a per-repo-aware write lands in. RepositoryPage, the commit
// box and useConventionalCommits consult this instead of each restating the key
// list or re-reading the flag — so adding an overridable setting is one edit here.

// Every local git key a repo override owns; cleared when the override is dropped.
export const REPO_OVERRIDE_KEYS = [
  'user.name',
  'user.email',
  'commit.gpgsign',
  'gpg.format',
  'user.signingkey',
  'glimpse.target',
  'glimpse.conventionalCommits',
  'core.sshCommand'
];

const FLAG = 'glimpse.override';

export function useRepoOverride() {
  const cfg = useGitConfig();

  // On when the flag is set, or any override key already has a local value.
  async function isOverriding() {
    const [flag, ...vals] = await Promise.all([
      cfg.read(FLAG, 'local'),
      ...REPO_OVERRIDE_KEYS.map((k) => cfg.read(k, 'local'))
    ]);
    return flag === 'true' || vals.some(Boolean);
  }

  async function enable() {
    await cfg.write(FLAG, 'true', 'local');
  }

  // Drop the flag and every local override → fall back to global. Sequential:
  // concurrent writes race on .git/config.lock.
  async function clear() {
    for (const key of [FLAG, ...REPO_OVERRIDE_KEYS]) {
      await cfg.clear(key, 'local');
    }
  }

  // The scope a per-repo-aware write should land in (the commit box uses this).
  async function effectiveScope(): Promise<'global' | 'local'> {
    return (await cfg.read(FLAG, 'local')) === 'true' ? 'local' : 'global';
  }

  return { isOverriding, enable, clear, effectiveScope };
}
