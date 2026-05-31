// Thin wrapper around tauri-plugin-updater. Checking actually fetches/installs
// only once a real signing key + release endpoint are configured (see
// tauri.conf.json plugins.updater); until then a manual check surfaces the
// error as a toast.
import { check } from '@tauri-apps/plugin-updater';
import { toast } from 'vue-sonner';

export function useUpdater() {
  const { t } = useI18n();
  const checking = ref(false);

  async function checkForUpdates(manual = true) {
    if (!isTauri()) return;
    checking.value = true;
    try {
      const update = await check();
      if (update) {
        toast.info(t('updater.available', { version: update.version }), {
          description: t('updater.installing')
        });
        await update.downloadAndInstall();
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
