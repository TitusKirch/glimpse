import { toast } from 'vue-sonner';

// How long an error toast stays on screen (mirrors the Sonner default set in
// components/ui/sonner/Sonner.vue). Repeats that land inside this window join
// the toast still showing rather than opening a new one.
const GROUP_MS = 5000;

// Failures arrive as a stream, not as single events: one user action is a dozen
// git calls, and the FS watcher can fire a reload several times a second. When
// the underlying cause hits all of them — a git binary that isn't there, a
// broken WSL target, the Simulation page's forced failures — the identical
// message would stack a toast per call and bury everything else on screen.
//
// So identical messages collapse into the one toast, which counts up instead of
// multiplying: sonner reuses the slot when it is handed the id it already has.
// A different message still gets its own toast — the point is to drop repeats,
// not to hide a second, genuinely different failure.
//
// The tally is module-level on purpose: the same failure reaching two different
// surfaces (the store's error watcher and the unhandled-rejection net) is still
// the one failure, and should still be the one toast.
let lastMessage = '';
let lastAt = 0;
let count = 0;

export function toastCollapsedError(title: string, message: string) {
  const now = Date.now();
  const repeat = message === lastMessage && now - lastAt < GROUP_MS;
  count = repeat ? count + 1 : 1;
  lastMessage = message;
  lastAt = now;
  toast.error(count > 1 ? `${title} (×${count})` : title, {
    // Keyed by the message, so the same failure always lands in the same slot
    // even when something else toasted in between.
    id: `error:${message}`,
    description: message
  });
}
