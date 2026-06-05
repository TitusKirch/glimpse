export type GitConfigScope = '' | 'global' | 'local' | 'system';

// The mechanism for reading and writing a git config key at a scope, through the
// active repo's git (or the default repo when none is open). Owns the routing
// path and the *inherit* rule: at local scope an empty value clears the key (so
// the global value is inherited again); at global scope an empty value is left
// untouched (never wipe the global identity). Settings components keep their own
// UI state and error toasts; this owns the round-trips so the load/save/inherit
// dance lives once instead of in every component.
export function useGitConfig() {
  const repo = useRepoStore();

  async function path() {
    return repo.active?.path ?? (await gitClient.defaultRepo());
  }

  async function read(key: string, scope: GitConfigScope) {
    return gitClient.getConfig({ path: await path(), key, scope });
  }

  async function write(key: string, value: string, scope: 'global' | 'local') {
    const p = await path();
    const trimmed = value.trim();
    if (!trimmed) {
      if (scope === 'local') await gitClient.unsetConfig({ path: p, key });
      return;
    }
    await gitClient.setConfig({
      path: p,
      key,
      value: trimmed,
      global: scope === 'global'
    });
  }

  async function clear(key: string, scope: 'global' | 'local' = 'local') {
    await gitClient.unsetConfig({ path: await path(), key, scope });
  }

  return { path, read, write, clear };
}
