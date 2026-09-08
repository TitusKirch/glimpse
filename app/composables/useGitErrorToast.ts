import { toast } from 'vue-sonner';

// How long a git error toast stays on screen (mirrors the Sonner default set in
// components/ui/sonner/Sonner.vue). Repeats that land inside this window join
// the toast still showing rather than opening a new one.
const GROUP_MS = 5000;

// Git failures arrive as a stream, not as single events: one user action can be
// a dozen git calls, and when the underlying cause hits all of them — a git
// binary that isn't there, a broken WSL target, the Simulation page's forced
// failures — the identical message would stack a dozen toasts and bury
// everything else on screen.
//
// So identical messages collapse into the one toast, which counts up instead of
// multiplying: sonner reuses the slot when it is handed the id it already has.
// A different message still gets its own toast — the point is to drop repeats,
// not to hide a second, genuinely different failure.
export function useGitErrorToast() {
  const { t } = useI18n();
  let lastMessage = '';
  let lastAt = 0;
  let count = 0;

  return (message: string) => {
    const now = Date.now();
    const repeat = message === lastMessage && now - lastAt < GROUP_MS;
    count = repeat ? count + 1 : 1;
    lastMessage = message;
    lastAt = now;
    toast.error(
      count > 1 ? `${t('error.title')} (×${count})` : t('error.title'),
      {
        // Keyed by the message, so the same failure always lands in the same slot
        // even when something else toasted in between.
        id: `git-error:${message}`,
        description: message
      }
    );
  };
}
