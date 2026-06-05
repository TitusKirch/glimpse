// Shared on/off state for the Conventional Commit composer, backed by
// `glimpse.conventionalCommits` in git config (effective = the repo's local
// override, else the global default). Module-level so the settings toggle and
// the commit box stay in sync live — without each re-reading independently
// (which is why toggling the setting used to have no visible effect on an
// already-open commit box). Writes are optimistic so the UI also responds in the
// browser demo, where the git-config IPC is mocked.
const enabled = ref(false);
const KEY = 'glimpse.conventionalCommits';

export function useConventionalCommits() {
  const repo = useRepoStore();
  const cfg = useGitConfig();
  const ovr = useRepoOverride();

  // Refresh the effective value for the active repo.
  async function load() {
    if (!isTauri() || !repo.active?.path) return;
    enabled.value = (await cfg.read(KEY, '')) === 'true';
  }

  // Persist to the scope in effect — local when this repo overrides globals,
  // otherwise the global default. Optimistic: the shared ref flips first.
  async function set(on: boolean) {
    enabled.value = on;
    if (!isTauri() || !repo.active?.path) return;
    await cfg.write(KEY, on ? 'true' : 'false', await ovr.effectiveScope());
  }

  return { enabled, load, set };
}
