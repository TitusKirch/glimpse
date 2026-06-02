// App auto-update, channel-aware. Goes through the Rust `check_update` /
// `install_update` commands (not the JS updater) so the active release channel
// can pick the manifest endpoint at runtime — the JS check() can only read the
// static config endpoints. Actual fetching works once the updater is configured
// with a real signing key + a published release for the channel.
import { toast } from 'vue-sonner';

export function useUpdater() {
  const { t } = useI18n();
  const layout = useLayoutStore();
  const checking = ref(false);

  // The channel string the Rust updater expects. For experiments it carries the
  // selected slug (`experiment:<slug>`) so it hits that experiment's manifest.
  function effectiveChannel(): string {
    if (layout.releaseChannel === 'experiment') {
      return layout.selectedExperiment
        ? `experiment:${layout.selectedExperiment}`
        : '';
    }
    return layout.releaseChannel;
  }

  async function checkForUpdates(manual = true) {
    if (!isTauri()) return;
    const channel = effectiveChannel();
    // Experiment channel with nothing picked yet — nothing to check.
    if (!channel) {
      if (manual) toast.error(t('updater.noExperiment'));
      return;
    }
    checking.value = true;
    try {
      const version = await tauriInvoke<string | null>({
        command: 'check_update',
        args: { channel },
        fallback: null
      });
      if (version) {
        toast.info(t('updater.available', { version }), {
          description: t('updater.installing')
        });
        await tauriInvoke({
          command: 'install_update',
          args: { channel },
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
