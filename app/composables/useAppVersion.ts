import { getVersion } from '@tauri-apps/api/app';

// Shared app version + build identity. Beta builds carry a SemVer pre-release
// suffix (e.g. "0.1.0-beta.3"); experiment builds carry "-exp.N" plus a slug
// baked in at compile time (read via the `experiment_name` command). In the
// browser/dev shell there is no Tauri app, so version stays "dev". State is
// shared via useState so the fetches happen once across all consumers.
export function useAppVersion() {
  const version = useState('app-version', () => 'dev');
  // The experiment slug of the running build, or null for stable/beta/dev.
  const experiment = useState<string | null>('app-experiment', () => null);
  const loaded = useState('app-version-loaded', () => false);
  if (import.meta.client && !loaded.value) {
    loaded.value = true;
    whenTauri(() =>
      getVersion()
        .then((v) => (version.value = v))
        .catch(() => {})
    );
    void tauriInvoke<string | null>({
      command: 'experiment_name',
      fallback: null
    })
      .then((n) => (experiment.value = n))
      .catch(() => {});
  }
  const isExperiment = computed(() => !!experiment.value);
  // A pre-release suffix marks a beta build — but an experiment is its own thing,
  // so exclude it here (the sidebar shows the experiment badge instead).
  const isBeta = computed(
    () => version.value.includes('-') && !isExperiment.value
  );
  return { version, experiment, isExperiment, isBeta };
}
