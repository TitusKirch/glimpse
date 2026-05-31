// App auto-update, channel-aware. Goes through the Rust `check_update` /
// `install_update` commands (not the JS updater) so the active release channel
// can pick the manifest endpoint at runtime — the JS check() can only read the
// static config endpoints. Actual fetching works once the updater is configured
// with a real signing key + a published release for the channel.
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'vue-sonner';

export function useUpdater() {
  const { t } = useI18n();
  const layout = useLayoutStore();
  const checking = ref(false);

  async function checkForUpdates(manual = true) {
    if (!isTauri()) return;
    checking.value = true;
    try {
      const channel = layout.releaseChannel;
      const version = await invoke<string | null>('check_update', { channel });
      if (version) {
        toast.info(t('updater.available', { version }), {
          description: t('updater.installing')
        });
        await invoke('install_update', { channel });
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
