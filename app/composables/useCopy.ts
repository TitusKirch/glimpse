// Clipboard helper with a small success toast. Returns a copy(text) function;
// call it from a component setup so it can resolve the active locale.
import { toast } from 'vue-sonner';

export function useCopy() {
  const { t } = useI18n();
  return async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('common.copied'));
    } catch (err) {
      console.error('clipboard write failed:', err);
    }
  };
}
