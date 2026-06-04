// The `glimpse` command-line launcher's installed state. The path (or null) is
// cached in the settings store and persisted, so the settings button renders the
// correct state instantly — no brief "enabled, then the check resolves, then
// disabled" flash. It's checked once on boot (app.vue) and re-checked, in the
// background, each time the settings dialog opens; the cached value shows
// meanwhile. Mirrors useExperiments: composable owns the IPC, store owns the cache.

export function useCliInstall() {
  const settings = useSettingsStore();

  // The cached installed launcher path, or null. Read straight from the store so
  // it survives reloads and is already populated before the button first renders.
  const installedPath = computed(() => settings.cliInstalled);

  // Re-read whether `glimpse` is on PATH for this build and update the cache.
  // Desktop-only; a no-op in the browser demo (so it never clobbers the cache).
  async function refresh() {
    if (!isTauri()) return;
    settings.cliInstalled = await gitClient.cliInstallStatus();
  }

  // Install (or re-install) the launcher, caching the resulting path so the
  // button reflects it immediately, without waiting for the next refresh.
  async function install(): Promise<string> {
    const path = await gitClient.installCli();
    settings.cliInstalled = path;
    return path;
  }

  return { installedPath, refresh, install };
}
