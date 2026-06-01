import { getVersion } from '@tauri-apps/api/app';

// Shared app version + pre-release flag. Beta builds carry a SemVer pre-release
// suffix (e.g. "0.1.0-beta.3"); stable builds don't. In the browser/dev shell
// there is no Tauri app, so the version stays "dev" (not a pre-release). State
// is shared via useState so the fetch happens once across all consumers.
export function useAppVersion() {
  const version = useState('app-version', () => 'dev');
  const loaded = useState('app-version-loaded', () => false);
  if (import.meta.client && !loaded.value) {
    loaded.value = true;
    if (isTauri()) {
      getVersion()
        .then((v) => (version.value = v))
        .catch(() => {});
    }
  }
  // A pre-release suffix is what distinguishes a beta build from a stable one —
  // this is the *running build*, not the updater channel preference.
  const isPrerelease = computed(() => version.value.includes('-'));
  return { version, isPrerelease };
}
