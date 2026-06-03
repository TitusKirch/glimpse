// App auto-update, channel-aware. Goes through the Rust `check_update` /
// `install_update` commands (not the JS updater) so the active release channel
// can pick the manifest endpoint at runtime — the JS check() can only read the
// static config endpoints. Actual fetching works once the updater is configured
// with a real signing key + a published release for the channel.
import { toast } from 'vue-sonner';

export function useUpdater() {
  const { t } = useI18n();
  const settings = useSettingsStore();
  const { version, experiment } = useAppVersion();
  const checking = ref(false);

  // The channel string the Rust updater expects. For experiments it carries the
  // selected slug (`experiment:<slug>`) so it hits that experiment's manifest.
  function effectiveChannel(): string {
    if (settings.releaseChannel === 'experiment') {
      return settings.selectedExperiment
        ? `experiment:${settings.selectedExperiment}`
        : '';
    }
    return settings.releaseChannel;
  }

  // Which channel the running build belongs to, inferred from its version.
  function runningChannel(): 'stable' | 'beta' | 'experiment' {
    if (experiment.value) return 'experiment';
    if (version.value.includes('-beta.')) return 'beta';
    return 'stable';
  }

  async function checkForUpdates(manual = true) {
    if (!isTauri()) return;
    const channel = effectiveChannel();
    // Experiment channel with nothing picked yet — nothing to check.
    if (!channel) {
      if (manual) toast.error(t('updater.noExperiment'));
      return;
    }
    // Switching channels (a manual check where the selected channel differs from
    // the running build's) installs that channel's current build even if it
    // isn't strictly newer — e.g. beta → the latest stable, a deliberate
    // downgrade. Automatic launch checks never force, so they can't downgrade.
    const force = manual && runningChannel() !== settings.releaseChannel;
    checking.value = true;
    try {
      const available = await tauriInvoke<string | null>({
        command: 'check_update',
        args: { channel, force },
        fallback: null
      });
      if (available) {
        toast.info(t('updater.available', { version: available }), {
          description: t('updater.installing')
        });
        await tauriInvoke({
          command: 'install_update',
          args: { channel, force },
          fallback: null
        });
        toast.success(t('updater.installed'));
      } else if (manual) {
        toast.success(t('updater.upToDate'));
      }
    } catch (err) {
      if (manual) {
        toast.error(t('updater.failed'), { description: String(err) });
      }
      console.error('update check failed:', err);
    } finally {
      checking.value = false;
    }
  }

  return { checking, checkForUpdates };
}
