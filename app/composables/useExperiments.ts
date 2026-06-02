import { useNow } from '@vueuse/core';

// Active experiments come from the public GitHub Releases API (no token needed,
// ~60 req/h unauthenticated). The list is cached in the layout store; we fetch
// it on boot and on a manual, throttled refresh only — never on a timer — to
// stay well under the rate limit.
const REPO = 'TitusKirch/glimpse';
const PREFIX = 'experiment-';
const THROTTLE_MS = 60_000;

export function useExperiments() {
  const layout = useLayoutStore();
  const now = useNow({ interval: 1000 });

  // True once the throttle window since the last fetch has elapsed.
  const canRefresh = computed(
    () => now.value.getTime() - layout.experimentsFetchedAt >= THROTTLE_MS
  );
  // Whole seconds left before a refresh is allowed again, clamped to [1, 60] as
  // a display failsafe (a skewed/zero `experimentsFetchedAt` could otherwise
  // compute a nonsensical value). Only shown while !canRefresh.
  const cooldown = computed(() => {
    const raw = Math.ceil(
      (THROTTLE_MS - (now.value.getTime() - layout.experimentsFetchedAt)) / 1000
    );
    return Math.min(60, Math.max(1, raw));
  });

  // Fetch the experiment slugs from open `experiment-*` releases. Honours the
  // throttle unless `force` (used by the manual button after the cooldown).
  async function refresh(force = false) {
    if (!force && !canRefresh.value) return;
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=100`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const releases = (await res.json()) as { tag_name?: string }[];
    const slugs = releases
      .map((r) => r.tag_name ?? '')
      .filter((t) => t.startsWith(PREFIX))
      .map((t) => t.slice(PREFIX.length))
      .filter(Boolean);
    layout.experiments = [...new Set(slugs)].sort();
    layout.experimentsFetchedAt = Date.now();
    // Drop a selection that no longer exists (e.g. its branch was deleted).
    if (
      layout.selectedExperiment &&
      !layout.experiments.includes(layout.selectedExperiment)
    ) {
      layout.selectedExperiment = '';
    }
  }

  return { canRefresh, cooldown, refresh };
}
